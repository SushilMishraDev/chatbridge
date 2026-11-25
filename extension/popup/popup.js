const $ = (id) => document.getElementById(id);

async function getBaseUrl() {
  const { apiUrl } = await chrome.storage.local.get("apiUrl");
  if (!apiUrl || apiUrl.includes(":5173")) {
    return "http://127.0.0.1:8000";
  }
  return apiUrl.replace(/\/+$/, "");
}

async function call(path, opts = {}) {
  const { token } = await chrome.storage.local.get("token");
  const baseUrl = await getBaseUrl();
  let res;
  try {
    res = await fetch(baseUrl + path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
    });
  } catch (err) {
    if (baseUrl.includes("127.0.0.1")) {
      res = await fetch("http://localhost:8000" + path, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
      });
    } else {
      throw err;
    }
  }

  if (res.status === 401 && path !== "/login" && path !== "/register") {
    await chrome.storage.local.remove("token");
    $("login").hidden = false;
    $("main").hidden = true;
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || ("HTTP error " + res.status));
  }
  return res.json();
}

async function showChats() {
  $("login").hidden = true;
  $("main").hidden = false;
  $("loginErr").textContent = "";

  try {
    const me = await call("/me").catch(() => null);
    if (me && me.email) {
      $("userEmail").textContent = "Logged in: " + me.email;
    }

    const chats = await call("/chats");
    $("chats").innerHTML = "";
    if (!chats || chats.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No chats saved yet. Open ChatGPT/Claude to scan!";
      li.style.cursor = "default";
      $("chats").appendChild(li);
      return;
    }

    for (const c of chats.slice(0, 15)) {
      const li = document.createElement("li");
      li.textContent = `${c.title} (${c.source}, ${c.messages} msgs)`;
      li.title = "Click to continue this chat on another AI";
      li.onclick = () => continueChat(c.id);
      $("chats").appendChild(li);
    }
  } catch (err) {
    $("msg").textContent = "Status: " + err.message;
  }
}

async function continueChat(id) {
  $("msg").textContent = "Building prompt...";
  chrome.runtime.sendMessage(
    { type: "HANDOFF", payload: { conversation_id: id, target: $("target").value } },
    (r) => {
      $("msg").textContent = r && r.ok ? "✓ Opened new tab with context prompt ready!" : "Failed: " + (r && r.error);
    }
  );
}

$("scanBtn").onclick = async () => {
  $("msg").textContent = "Scanning active tab...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      $("msg").textContent = "Could not find active browser tab.";
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_CAPTURE" }, async (res) => {
      if (chrome.runtime.lastError) {
        $("msg").textContent = "Make sure you are on a ChatGPT, Claude, or Gemini tab.";
        return;
      }
      if (res && res.ok) {
        $("msg").textContent = `✓ Synced "${(res.title || "Chat").slice(0, 20)}" (${res.messages || ""} msgs)`;
        setTimeout(showChats, 800);
      } else {
        $("msg").textContent = res && res.error ? res.error : "Scan in progress...";
      }
    });
  } catch (e) {
    $("msg").textContent = "Error: " + e.message;
  }
};

$("loginBtn").onclick = async () => {
  $("loginErr").textContent = "";
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;

  if (!email || !password) {
    $("loginErr").textContent = "Please enter both email and password.";
    return;
  }

  try {
    const out = await call("/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await chrome.storage.local.set({ token: out.token });
    showChats();
  } catch (err) {
    $("loginErr").textContent = err.message || "Login failed.";
  }
};

$("logoutBtn").onclick = async () => {
  await chrome.storage.local.remove("token");
  $("main").hidden = true;
  $("login").hidden = false;
  $("chats").innerHTML = "";
  $("msg").textContent = "";
};

chrome.storage.local.get("token").then(({ token }) => {
  if (token) showChats();
});
