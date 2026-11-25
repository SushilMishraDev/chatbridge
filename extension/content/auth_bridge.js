(() => {
  // Only activate if this page is ChatBridge
  const isChatBridge =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    document.title.includes("ChatBridge") ||
    document.querySelector("meta[name='application-name'][content='ChatBridge']");

  if (!isChatBridge) return;

  // Mark extension presence in the web app DOM
  const marker = document.createElement("div");
  marker.id = "chatbridge-extension-installed";
  marker.style.display = "none";
  marker.dataset.version = "0.3.7";
  document.documentElement.appendChild(marker);

  function syncAuth(isInitial = false) {
    try {
      const token = localStorage.getItem("token");
      if (token) {
        // When running in local development on Vite (port 5173), point to FastAPI backend on port 8000
        const isViteDev = location.port === "5173";
        const apiUrl = isViteDev ? "http://127.0.0.1:8000" : location.origin;
        chrome.runtime.sendMessage({
          type: "SET_TOKEN",
          token,
          apiUrl,
        });
      }
    } catch {}
  }

  function savePendingPrompt(data) {
    if (!data || !data.prompt) return;
    try {
      chrome.runtime.sendMessage({
        type: "SET_PENDING_PROMPT",
        prompt: data.prompt,
        target: data.target || "",
        title: data.title || "",
        messages: data.messages || [],
        nextMessage: data.nextMessage || data.next_message || "",
      });
    } catch {}
  }

  // 1. window.postMessage (Cross-world standard in Manifest V3)
  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "CHATBRIDGE_SET_PROMPT" && e.data.prompt) {
      savePendingPrompt(e.data);
    }
    if (e.data && (e.data.type === "CHATBRIDGE_TRIGGER_AUTO_COLLECT" || e.data.type === "TRIGGER_AUTO_COLLECT_ALL")) {
      chrome.runtime.sendMessage({ type: "TRIGGER_AUTO_COLLECT_ALL" });
    }
    if (e.data && e.data.type === "CHATBRIDGE_SYNC_PLATFORM") {
      chrome.runtime.sendMessage({ type: "SYNC_PLATFORM_ALL", platform: e.data.platform });
    }
  });

  // 2. CustomEvents on window and document
  window.addEventListener("chatbridge:set-prompt", (e) => {
    if (e.detail && e.detail.prompt) {
      savePendingPrompt(e.detail);
    }
  });
  document.addEventListener("chatbridge:set-prompt", (e) => {
    if (e.detail && e.detail.prompt) {
      savePendingPrompt(e.detail);
    }
  });

  // 3. Periodic DOM transfer element checker
  setInterval(() => {
    const el = document.getElementById("chatbridge-prompt-transfer");
    if (el && el.textContent) {
      savePendingPrompt({ prompt: el.textContent, target: el.dataset.target || "" });
      el.remove();
    }
  }, 400);

  // 4. Trigger auto-collection across all open AI tabs
  window.addEventListener("chatbridge:trigger-auto-collect", () => {
    chrome.runtime.sendMessage({ type: "TRIGGER_AUTO_COLLECT_ALL" });
  });

  window.addEventListener("chatbridge:sync-platform", (e) => {
    chrome.runtime.sendMessage({ type: "SYNC_PLATFORM_ALL", platform: e.detail?.platform });
  });

  syncAuth(true);
  window.addEventListener("storage", () => syncAuth(false));
  setInterval(() => syncAuth(false), 2000);
})();
