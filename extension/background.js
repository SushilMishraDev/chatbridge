async function getBaseUrl() {
  const { apiUrl } = await chrome.storage.local.get("apiUrl");
  if (!apiUrl || apiUrl.includes(":5173")) {
    return "http://127.0.0.1:8000";
  }
  return apiUrl.replace(/\/+$/, "");
}

async function getToken() {
  const { token } = await chrome.storage.local.get("token");
  return token || null;
}

async function api(path, body) {
  const token = await getToken();
  if (!token) throw new Error("Not logged in");

  const baseUrl = await getBaseUrl();
  let res;

  try {
    res = await fetch(baseUrl + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // If baseUrl was localhost or 127.0.0.1, try alternative local loopback
    if (baseUrl.includes("127.0.0.1")) {
      res = await fetch("http://localhost:8000" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(body),
      });
    } else if (baseUrl.includes("localhost:8000")) {
      res = await fetch("http://127.0.0.1:8000" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(body),
      });
    } else {
      throw err;
    }
  }

  if (!res.ok) throw new Error("Server said " + res.status);
  return res.json();
}

// Intercept Authorization header from outgoing requests to ChatGPT backend API
try {
  if (chrome.webRequest && chrome.webRequest.onBeforeSendHeaders) {
    chrome.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        if (details.requestHeaders) {
          const h = details.requestHeaders.find(
            (header) => header.name.toLowerCase() === "authorization"
          );
          if (h && h.value && h.value.startsWith("Bearer ")) {
            chrome.storage.local.set({ chatgpt_bearer_token: h.value });
          }
        }
      },
      { urls: ["*://*.chatgpt.com/backend-api/*", "*://chatgpt.com/backend-api/*"] },
      ["requestHeaders"]
    );
  }
} catch (e) {
  console.warn("[ChatBridge] webRequest listener not available:", e);
}

async function autoCollectAcrossAllOpenTabs() {
  const token = await getToken();
  if (!token) return;

  try {
    const tabs = await chrome.tabs.query({});
    const aiTabs = tabs.filter(
      (t) =>
        t.url &&
        (t.url.includes("chatgpt.com") ||
          t.url.includes("openai.com") ||
          t.url.includes("claude.ai") ||
          t.url.includes("gemini.google.com"))
    );

    console.log(`[ChatBridge] Found ${aiTabs.length} open AI tabs for auto-collection.`);
    for (const tab of aiTabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, { type: "AUTO_COLLECT_NOW" }, (resp) => {
        if (chrome.runtime.lastError) {
          // Tab was open before extension reloaded; dynamically inject content scripts!
          try {
            chrome.scripting
              .executeScript({
                target: { tabId: tab.id },
                files: ["adapters/sites.js", "content/capture.js", "content/inject.js"],
              })
              .then(() => {
                setTimeout(() => {
                  chrome.tabs.sendMessage(tab.id, { type: "AUTO_COLLECT_NOW" });
                }, 600);
              })
              .catch(() => {});
          } catch {}
        } else if (resp && resp.ok) {
          console.log(`[ChatBridge] Auto-collected chat: "${resp.title}" (${resp.messages} msgs)`);
        }
      });
    }
  } catch (err) {
    console.warn("[ChatBridge] Error querying tabs for auto-collection:", err);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SET_TOKEN") {
    const toSet = { token: msg.token };
    if (msg.apiUrl) toSet.apiUrl = msg.apiUrl;
    chrome.storage.local.set(toSet, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "TRIGGER_AUTO_COLLECT_ALL") {
    autoCollectAcrossAllOpenTabs().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "SYNC_PLATFORM_ALL") {
    (async () => {
      const targetPlatform = (msg.platform || "chatgpt").toLowerCase();
      const domainMap = {
        chatgpt: "chatgpt.com",
        claude: "claude.ai",
        gemini: "gemini.google.com",
      };
      const domain = domainMap[targetPlatform] || "chatgpt.com";
      const startUrl =
        targetPlatform === "claude"
          ? "https://claude.ai/"
          : targetPlatform === "gemini"
          ? "https://gemini.google.com/app"
          : "https://chatgpt.com/";

      const tabs = await chrome.tabs.query({});
      let matchingTab = tabs.find((t) => t.url && t.url.includes(domain));

      if (matchingTab && matchingTab.id) {
        chrome.tabs.sendMessage(matchingTab.id, { type: "AUTO_COLLECT_NOW" }, (resp) => {
          sendResponse(resp || { ok: true, activeTabUsed: true });
        });
      } else {
        // Open the platform tab and start sync
        chrome.tabs.create({ url: startUrl, active: true }, (newTab) => {
          sendResponse({ ok: true, openedNewTab: true, tabId: newTab?.id });
        });
      }
    })();
    return true;
  }

  if (msg.type === "OPEN_PLATFORM_NEW_CHAT") {
    (async () => {
      const targetPlatform = (msg.platform || "chatgpt").toLowerCase();
      const startUrl =
        targetPlatform === "claude"
          ? "https://claude.ai/new"
          : targetPlatform === "gemini"
          ? "https://gemini.google.com/app"
          : "https://chatgpt.com/";
      chrome.tabs.create({ url: startUrl, active: true }, (newTab) => {
        sendResponse({ ok: true, openedNewTab: true, tabId: newTab?.id });
      });
    })();
    return true;
  }

  if (msg.type === "SET_PENDING_PROMPT") {
    chrome.storage.local.set(
      {
        pendingPrompt: msg.prompt,
        pendingTarget: msg.target || "",
        pendingTitle: msg.title || "",
        pendingMessages: msg.messages || [],
        pendingNextMessage: msg.nextMessage || "",
        pendingTimestamp: Date.now(),
      },
      () => {
        sendResponse({ ok: true });
      }
    );
    return true;
  }

  if (msg.type === "GET_PENDING_PROMPT") {
    (async () => {
      // 1. Check local storage first
      try {
        const { pendingPrompt, pendingTimestamp, pendingTarget, pendingMessages, pendingNextMessage, pendingTitle } =
          await chrome.storage.local.get([
            "pendingPrompt",
            "pendingTimestamp",
            "pendingTarget",
            "pendingMessages",
            "pendingNextMessage",
            "pendingTitle",
          ]);
        if (
          pendingPrompt &&
          pendingTimestamp &&
          Date.now() - pendingTimestamp < 30 * 60 * 1000
        ) {
          return sendResponse({
            ok: true,
            prompt: pendingPrompt,
            messages: pendingMessages || [],
            nextMessage: pendingNextMessage || "",
            title: pendingTitle || "",
            target: pendingTarget,
            timestamp: pendingTimestamp,
          });
        }
      } catch {}

      // 2. Fetch directly from backend server if local storage doesn't have it
      try {
        const targetQuery = msg.target ? `?target=${encodeURIComponent(msg.target)}` : "";
        let res;
        try {
          res = await fetch("http://127.0.0.1:8000/handoff/latest" + targetQuery);
        } catch {
          res = await fetch("http://localhost:8000/handoff/latest" + targetQuery);
        }

        if (res && res.ok) {
          const data = await res.json();
          if (data && data.prompt) {
            await chrome.storage.local.set({
              pendingPrompt: data.prompt,
              pendingMessages: data.messages || [],
              pendingNextMessage: data.next_message || "",
              pendingTitle: data.title || "",
              pendingTarget: data.target || msg.target || "",
              pendingTimestamp: Date.now(),
            });
            return sendResponse({
              ok: true,
              prompt: data.prompt,
              messages: data.messages || [],
              nextMessage: data.next_message || "",
              title: data.title || "",
              target: data.target,
            });
          }
        }
      } catch (err) {
        console.warn("Could not query backend for latest handoff:", err);
      }

      sendResponse({ ok: false, prompt: null });
    })();
    return true;
  }

  if (msg.type === "GET_STATUS") {
    (async () => {
      const token = await getToken();
      const apiUrl = await getBaseUrl();
      sendResponse({ ok: true, loggedIn: !!token, apiUrl });
    })();
    return true;
  }

  if (msg.type === "SYNC") {
    (async () => {
      try {
        const out = await api("/sync", msg.payload);
        sendResponse({ ok: true, data: out });
      } catch (e) {
        console.warn("ChatBridge sync failed:", e.message);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }


  if (msg.type === "SYNC_BATCH") {
    (async () => {
      try {
        const out = await api("/sync/batch", msg.payload);
        sendResponse({ ok: true, data: out });
      } catch (e) {
        console.warn("ChatBridge batch sync failed:", e.message);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === "HANDOFF") {
    (async () => {
      try {
        const out = await api("/handoff", msg.payload);
        await chrome.storage.local.set({ pendingPrompt: out.prompt });
        await chrome.tabs.create({ url: out.url });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
});
