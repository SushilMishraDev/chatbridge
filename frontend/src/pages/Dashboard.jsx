import { useEffect, useState, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { download } from "../download";

const PLATFORMS = [
  { id: "all", label: "All chats" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
];

const TARGET_PLATFORMS = [
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "claude", label: "Claude", url: "https://claude.ai/new" },
  { id: "gemini", label: "Gemini", url: "https://gemini.google.com/app" },
];

function formatRecentActivity(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getBadgeClass(source) {
  const s = (source || "").toLowerCase();
  if (s.includes("chatgpt")) return "badge-chatgpt";
  if (s.includes("claude")) return "badge-claude";
  if (s.includes("gemini")) return "badge-gemini";
  return "badge-default";
}

function getFileIcon(filename) {
  const f = (filename || "").toLowerCase();
  if (f.endsWith(".pdf")) return "📕";
  if (f.endsWith(".py")) return "🐍";
  if (f.endsWith(".csv") || f.endsWith(".xlsx") || f.endsWith(".xls")) return "📊";
  if (f.endsWith(".docx") || f.endsWith(".doc") || f.endsWith(".txt")) return "📄";
  if (f.endsWith(".json") || f.endsWith(".js") || f.endsWith(".ts") || f.endsWith(".html") || f.endsWith(".css")) return "💻";
  if (f.endsWith(".zip") || f.endsWith(".tar") || f.endsWith(".gz") || f.endsWith(".rar")) return "📦";
  if (f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg") || f.endsWith(".webp") || f.endsWith(".svg")) return "🖼️";
  return "📁";
}

function parseMessageSegments(content) {
  if (!content) return [];

  // Remove private unicode markers like \ue200filecite...
  let text = content.replace(/\ue200[^\ue201]*\ue201/g, "");

  const pattern = /(?:!\[([^\]]*)\]\(([^)]+)\))|(?:\[Image Attachment(?::\s*([^\]]+))?\])|(?:\[(?:📁\s*)?(?:Attached File|File Attachment):\s*([^\]]+)\])|(?:\[(Download [^\]]+|[^\]]+\.(?:pdf|docx?|xlsx?|csv|txt|py|js|ts|json|zip|tar|gz|cpp|c|java))\]\(([^)]+)\))/gi;

  const segments = [];
  let lastIdx = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: "text", value: text.slice(lastIdx, match.index) });
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // 1. Standard markdown image ![alt](src)
      segments.push({
        type: "image",
        alt: match[1].trim() || "Attached Picture",
        src: match[2].trim(),
      });
    } else if (match[0].toLowerCase().includes("image attachment")) {
      // 2. [Image Attachment: name] or [Image Attachment]
      const name = match[3] ? match[3].trim() : "Attached Image / Photo";
      segments.push({
        type: "image_placeholder",
        name,
      });
    } else if (match[4]) {
      // 3. [Attached File: name]
      segments.push({
        type: "file",
        name: match[4].trim(),
        url: null,
      });
    } else if (match[5] && match[6]) {
      // 4. [Download filename](url) or [filename.pdf](url)
      segments.push({
        type: "file",
        name: match[5].trim(),
        url: match[6].trim(),
      });
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    segments.push({ type: "text", value: text.slice(lastIdx) });
  }

  return segments;
}

export default function Dashboard() {
  const { id: routeId } = useParams();
  const nav = useNavigate();

  const [chats, setChats] = useState([]);
  const [selectedId, setSelectedId] = useState(routeId ? Number(routeId) : null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const hasInitialSelected = useRef(!!selectedId);

  const [activeChat, setActiveChat] = useState(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("all");
  const [sortBy, setSortBy] = useState("newest"); // "newest", "oldest", "messages", "title"
  const [viewMode, setViewMode] = useState("split"); // "split" (Side-by-side) or "columns" (3-Platform columns)
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState("");
  const [extensionDetected, setExtensionDetected] = useState(null);
  const [isAutoCollecting, setIsAutoCollecting] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);

  // Handoff state
  const [nextMessage, setNextMessage] = useState("");
  const [isLoadingHandoff, setIsLoadingHandoff] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState("");
  const [selectedTarget, setSelectedTarget] = useState("");

  // Load chats list without forcibly resetting the user's selected conversation
  function load() {
    api("/chats")
      .then((data) => {
        setChats(data);
        if (!hasInitialSelected.current && !selectedIdRef.current && data.length > 0 && !routeId) {
          hasInitialSelected.current = true;
          const withImgs = data.find((c) => c.has_images);
          const initialId = withImgs ? withImgs.id : data[0].id;
          selectedIdRef.current = initialId;
          setSelectedId(initialId);
        }
      })
      .catch(() => setChats([]));
  }

  // Load active chat details whenever selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setActiveChat(null);
      return;
    }
    setLoadingChat(true);
    api(`/chats/${selectedId}`)
      .then((data) => {
        setActiveChat(data);
        setCopiedPrompt("");
      })
      .catch(() => setActiveChat(null))
      .finally(() => setLoadingChat(false));
  }, [selectedId]);

  useEffect(() => {
    if (routeId) {
      hasInitialSelected.current = true;
      selectedIdRef.current = Number(routeId);
      setSelectedId(Number(routeId));
    }
  }, [routeId]);

  useEffect(() => {
    load();
    api("/me").then(setMe).catch(() => {});

    const checkExt = () => {
      setExtensionDetected(!!document.getElementById("chatbridge-extension-installed"));
    };
    checkExt();
    const extInterval = setInterval(checkExt, 2000);

    const onFocus = () => load();
    window.addEventListener("focus", onFocus);

    // Refresh chat list every 30 seconds (no thrashing or snapping back)
    const pollInterval = setInterval(load, 30000);

    return () => {
      clearInterval(extInterval);
      clearInterval(pollInterval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  function triggerAutoCollect() {
    setIsAutoCollecting(true);
    setStatus("⚡ Scanning and auto-collecting conversations from all open AI tabs...");
    try {
      window.dispatchEvent(new CustomEvent("chatbridge:trigger-auto-collect"));
      window.postMessage({ type: "CHATBRIDGE_TRIGGER_AUTO_COLLECT" }, "*");
    } catch {}

    setTimeout(load, 1200);
    setTimeout(load, 2500);
    setTimeout(() => {
      load();
      setIsAutoCollecting(false);
      setStatus("✓ Auto-collect complete! Your conversations are updated below.");
      setTimeout(() => setStatus(""), 6000);
    }, 4500);
  }

  function syncPlatformHistory(targetPlatform) {
    setIsAutoCollecting(true);
    const pName = targetPlatform.toUpperCase();
    setStatus(`⚡ Connecting to ${pName} to pull your complete conversation history...`);
    try {
      window.dispatchEvent(
        new CustomEvent("chatbridge:sync-platform", {
          detail: { platform: targetPlatform },
        })
      );
      window.postMessage(
        { type: "CHATBRIDGE_SYNC_PLATFORM", platform: targetPlatform },
        "*"
      );
    } catch {}

    const intervals = [1200, 2500, 4500, 7500, 11000];
    for (const d of intervals) {
      setTimeout(load, d);
    }
    setTimeout(() => {
      load();
      setIsAutoCollecting(false);
      setStatus(`✓ Synchronized all history from ${pName}!`);
      setTimeout(() => setStatus(""), 7000);
    }, 13000);
  }

  async function continueWith(targetId) {
    if (!activeChat) return;
    const targetObj = TARGET_PLATFORMS.find((p) => p.id === targetId);
    const platformName = targetObj ? targetObj.label : targetId;
    setSelectedTarget(platformName);
    setIsLoadingHandoff(true);

    try {
      const out = await api("/handoff", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: activeChat.id,
          target: targetId,
          next_message: nextMessage.trim() || null,
        }),
      });

      setCopiedPrompt(out.prompt);

      // ALWAYS write the complete uneditable history prompt to clipboard
      try {
        await navigator.clipboard.writeText(out.prompt);
      } catch (err) {
        console.warn("Could not copy prompt to clipboard automatically:", err);
      }

      try {
        localStorage.setItem("chatbridge_pending_prompt", out.prompt);
        localStorage.setItem("chatbridge_pending_target", targetId);
        localStorage.setItem("chatbridge_pending_title", activeChat.title);
      } catch {}

      const handoffPayload = {
        type: "CHATBRIDGE_SET_PROMPT",
        prompt: out.prompt,
        target: targetId,
        title: activeChat.title,
        messages: activeChat.messages,
        nextMessage: nextMessage.trim(),
      };

      try {
        window.postMessage(handoffPayload, "*");
      } catch {}

      try {
        window.dispatchEvent(
          new CustomEvent("chatbridge:set-prompt", {
            detail: handoffPayload,
          })
        );
      } catch {}

      await new Promise((r) => setTimeout(r, 200));
      window.open(out.url, "_blank");
    } catch (e) {
      alert("Could not prepare handoff: " + e.message);
    } finally {
      setIsLoadingHandoff(false);
    }
  }

  async function removeChat(chatId) {
    if (!window.confirm("Delete this conversation from ChatBridge?")) return;
    await api(`/chats/${chatId}`, { method: "DELETE" });
    setSelectedId(null);
    setActiveChat(null);
    load();
  }

  function logout() {
    localStorage.removeItem("token");
    nav("/login");
  }

  const shownChats = chats.filter((c) => {
    const matchesQ = c.title.toLowerCase().includes(q.toLowerCase());
    const matchesPlatform = platform === "all" || c.source.toLowerCase() === platform;
    return matchesQ && matchesPlatform;
  });

  const sortFunction = (a, b) => {
    if (sortBy === "oldest") {
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    }
    if (sortBy === "messages") {
      return (b.messages || 0) - (a.messages || 0);
    }
    if (sortBy === "title") {
      return a.title.localeCompare(b.title);
    }
    // Default: newest first
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  };

  const sortedChats = [...shownChats].sort(sortFunction);
  const chatgptChats = [...chats.filter((c) => c.source.toLowerCase() === "chatgpt")].sort(sortFunction);
  const claudeChats = [...chats.filter((c) => c.source.toLowerCase() === "claude")].sort(sortFunction);
  const geminiChats = [...chats.filter((c) => c.source.toLowerCase() === "gemini")].sort(sortFunction);

  return (
    <div className="side-by-side-app">
      {/* LEFT SIDEBAR: Conversation History (like ChatGPT / Claude / Gemini) */}
      <aside className="app-sidebar">
        <div className="sidebar-header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Link to="/" style={{ textDecoration: "none", display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span className="wordmark" style={{ fontSize: "22px" }}>ChatBridge</span>
            </Link>
            <span
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "12px",
                background: extensionDetected === true ? "rgba(47,93,80,0.12)" : extensionDetected === false ? "rgba(217,119,6,0.12)" : "rgba(0,0,0,0.06)",
                color: extensionDetected === true ? "#2f5d50" : extensionDetected === false ? "#b45309" : "var(--muted)",
                fontWeight: 600,
              }}
            >
              {extensionDetected === true ? "🟢 Extension v0.3.4" : extensionDetected === false ? "⚠️ Extension off" : "Checking extension…"}
            </span>
          </div>

          {extensionDetected === false && (
            <div
              role="status"
              style={{
                padding: "10px 12px",
                borderRadius: "10px",
                background: "#fffbeb",
                border: "1px solid #fde68a",
                color: "#92400e",
                fontSize: "12px",
                lineHeight: 1.5,
              }}
            >
              <strong>ChatBridge extension is off or not detected.</strong>
              <div>
                Open <code>chrome://extensions</code>, switch ChatBridge on, then refresh this page. If it isn’t listed, install the extension first.
              </div>
            </div>
          )}

          {/* View Mode Switcher: Side-by-Side Chat vs 3-Platform Columns */}
          <div style={{ display: "flex", background: "rgba(0,0,0,0.05)", padding: "3px", borderRadius: "10px", gap: "4px" }}>
            <button
              type="button"
              onClick={() => setViewMode("split")}
              style={{
                flex: 1,
                border: "none",
                borderRadius: "8px",
                padding: "5px 8px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                background: viewMode === "split" ? "#ffffff" : "transparent",
                color: viewMode === "split" ? "var(--ink)" : "var(--muted)",
                boxShadow: viewMode === "split" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
              }}
            >
              💬 Side-by-Side
            </button>
            <button
              type="button"
              onClick={() => setViewMode("columns")}
              style={{
                flex: 1,
                border: "none",
                borderRadius: "8px",
                padding: "5px 8px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                background: viewMode === "columns" ? "#ffffff" : "transparent",
                color: viewMode === "columns" ? "var(--ink)" : "var(--muted)",
                boxShadow: viewMode === "columns" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
              }}
            >
              ☵ 3-AI Columns
            </button>
          </div>

          {/* Platform Filters */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`filter-btn ${platform === p.id ? "active" : ""}`}
                style={{ padding: "4px 10px", fontSize: "11px" }}
                onClick={() => setPlatform(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search conversations..."
            style={{ padding: "8px 10px", fontSize: "12px", borderRadius: "8px" }}
          />

          {/* Sort Order Selector */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
            <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>Sort order:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                padding: "4px 8px",
                fontSize: "11px",
                borderRadius: "6px",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--ink)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <option value="newest">⏱️ Newest First</option>
              <option value="oldest">⏳ Oldest First</option>
              <option value="messages">💬 Most Messages</option>
              <option value="title">🔤 Title (A–Z)</option>
            </select>
          </div>

          {/* Auto-Collect Button */}
          <button
            type="button"
            onClick={triggerAutoCollect}
            disabled={isAutoCollecting}
            style={{
              background: "#2f5d50",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "7px 12px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isAutoCollecting ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            {isAutoCollecting ? "⏳ Collecting..." : "⚡ Auto-Collect Open AI Tabs"}
          </button>

          {/* Quick Pull for all 3 AI platforms */}
          <div style={{ display: "flex", gap: "5px" }}>
            <button
              type="button"
              onClick={() => syncPlatformHistory("chatgpt")}
              disabled={isAutoCollecting}
              title="Pull all conversation history from ChatGPT"
              style={{
                flex: 1,
                padding: "5px 4px",
                fontSize: "11px",
                fontWeight: 700,
                borderRadius: "6px",
                border: "1px solid rgba(16,163,127,0.3)",
                background: "rgba(16,163,127,0.08)",
                color: "#0e755b",
                cursor: "pointer",
              }}
            >
              🟢 ChatGPT
            </button>
            <button
              type="button"
              onClick={() => syncPlatformHistory("claude")}
              disabled={isAutoCollecting}
              title="Pull all conversation history from Claude"
              style={{
                flex: 1,
                padding: "5px 4px",
                fontSize: "11px",
                fontWeight: 700,
                borderRadius: "6px",
                border: "1px solid rgba(217,119,6,0.3)",
                background: "rgba(217,119,6,0.08)",
                color: "#b45309",
                cursor: "pointer",
              }}
            >
              🟠 Claude
            </button>
            <button
              type="button"
              onClick={() => syncPlatformHistory("gemini")}
              disabled={isAutoCollecting}
              title="Pull all conversation history from Gemini"
              style={{
                flex: 1,
                padding: "5px 4px",
                fontSize: "11px",
                fontWeight: 700,
                borderRadius: "6px",
                border: "1px solid rgba(37,99,235,0.3)",
                background: "rgba(37,99,235,0.08)",
                color: "#1d4ed8",
                cursor: "pointer",
              }}
            >
              🔵 Gemini
            </button>
          </div>
        </div>

        {/* Scrollable Conversation History List */}
        <div className="sidebar-scroll">
          {sortedChats.length === 0 ? (
            <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--muted)", fontSize: "13px" }}>
              <p style={{ margin: "0 0 6px", fontWeight: 700, color: "var(--ink)" }}>
                {platform === "all" ? "No conversations found" : `No ${platform.toUpperCase()} conversations found`}
              </p>
              <p style={{ margin: "0 0 14px", fontSize: "12px" }}>
                Pull and sync your history from any of your 3 AI platforms:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => syncPlatformHistory("chatgpt")}
                  style={{
                    fontSize: "11px",
                    padding: "7px 12px",
                    background: "#10a37f",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ⚡ Pull from ChatGPT
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => syncPlatformHistory("claude")}
                  style={{
                    fontSize: "11px",
                    padding: "7px 12px",
                    background: "#d97706",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ⚡ Pull from Claude
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => syncPlatformHistory("gemini")}
                  style={{
                    fontSize: "11px",
                    padding: "7px 12px",
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ⚡ Pull from Gemini
                </button>
              </div>
            </div>
          ) : (
            sortedChats.map((c) => (
              <div
                key={c.id}
                className={`chat-item ${selectedId === c.id ? "active" : ""}`}
                onClick={() => {
                  hasInitialSelected.current = true;
                  selectedIdRef.current = c.id;
                  setSelectedId(c.id);
                  if (viewMode === "columns") setViewMode("split");
                }}
              >
                <div style={{ overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                    <span className={`source ${getBadgeClass(c.source)}`}>{c.source}</span>
                    {c.has_images && (
                      <span
                        style={{
                          fontSize: "10px",
                          background: "rgba(2, 132, 199, 0.12)",
                          color: "#0284c7",
                          padding: "1px 6px",
                          borderRadius: "8px",
                          fontWeight: 700,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        🖼️ Pics & Files
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: selectedId === c.id ? 700 : 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.title}
                  </div>
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>{c.messages} msgs</div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
                    {formatRecentActivity(c.updated_at)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px", color: "var(--muted)" }}>
            {me?.email}
          </span>
          <button className="ghost" type="button" onClick={logout} style={{ padding: "4px 10px", fontSize: "11px" }}>
            Log out
          </button>
        </div>
      </aside>

      {/* RIGHT MAIN VIEW */}
      {viewMode === "columns" ? (
        /* MODE 2: 3-PLATFORM SIDE-BY-SIDE COLUMNS (ChatGPT | Claude | Gemini) */
        <main className="app-chat-main">
          <div className="chat-main-header">
            <div>
              <h2 style={{ margin: 0, fontFamily: "Fraunces, Georgia, serif", fontSize: "20px" }}>
                AI Platforms History Side-by-Side
              </h2>
              <span className="meta" style={{ fontSize: "12px" }}>
                All your chats from ChatGPT, Claude, and Gemini displayed in dedicated columns
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setViewMode("split")}
                style={{ fontSize: "12px", padding: "6px 14px" }}
              >
                💬 Open Side-by-Side Chat
              </button>
            </div>
          </div>

          <div className="platform-columns-view">
            {/* COLUMN 1: ChatGPT */}
            <div className="platform-col">
              <div className="col-header" style={{ background: "rgba(16, 163, 127, 0.08)", color: "#0e755b" }}>
                <span>🟢 ChatGPT ({chatgptChats.length})</span>
                <button
                  type="button"
                  onClick={() => syncPlatformHistory("chatgpt")}
                  style={{
                    background: "#10a37f",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "11px",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ⚡ Sync
                </button>
              </div>
              <div className="col-scroll">
                {chatgptChats.length === 0 ? (
                  <p className="meta" style={{ textAlign: "center", padding: "20px 0" }}>No ChatGPT chats yet.</p>
                ) : (
                  chatgptChats.map((c) => (
                    <div
                      key={c.id}
                      className="chat-item"
                      onClick={() => {
                        hasInitialSelected.current = true;
                        selectedIdRef.current = c.id;
                        setSelectedId(c.id);
                        setViewMode("split");
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <b style={{ fontSize: "13px" }}>{c.title}</b>
                          {c.has_images && <span style={{ fontSize: "10px", color: "#0284c7", fontWeight: 700 }}>🖼️ Pics & Files</span>}
                        </div>
                        <div className="meta" style={{ fontSize: "11px" }}>{c.messages} messages &bull; {formatRecentActivity(c.updated_at)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* COLUMN 2: Claude */}
            <div className="platform-col">
              <div className="col-header" style={{ background: "rgba(217, 119, 6, 0.08)", color: "#b45309" }}>
                <span>🟠 Claude ({claudeChats.length})</span>
                <button
                  type="button"
                  onClick={() => syncPlatformHistory("claude")}
                  style={{
                    background: "#d97706",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "11px",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ⚡ Sync
                </button>
              </div>
              <div className="col-scroll">
                {claudeChats.length === 0 ? (
                  <p className="meta" style={{ textAlign: "center", padding: "20px 0" }}>No Claude chats yet.</p>
                ) : (
                  claudeChats.map((c) => (
                    <div
                      key={c.id}
                      className="chat-item"
                      onClick={() => {
                        hasInitialSelected.current = true;
                        selectedIdRef.current = c.id;
                        setSelectedId(c.id);
                        setViewMode("split");
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <b style={{ fontSize: "13px" }}>{c.title}</b>
                          {c.has_images && <span style={{ fontSize: "10px", color: "#0284c7", fontWeight: 700 }}>🖼️ Pics & Files</span>}
                        </div>
                        <div className="meta" style={{ fontSize: "11px" }}>{c.messages} messages &bull; {formatRecentActivity(c.updated_at)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* COLUMN 3: Gemini */}
            <div className="platform-col">
              <div className="col-header" style={{ background: "rgba(37, 99, 235, 0.08)", color: "#1d4ed8" }}>
                <span>🔵 Gemini ({geminiChats.length})</span>
                <button
                  type="button"
                  onClick={() => syncPlatformHistory("gemini")}
                  style={{
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "11px",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  ⚡ Sync
                </button>
              </div>
              <div className="col-scroll">
                {geminiChats.length === 0 ? (
                  <p className="meta" style={{ textAlign: "center", padding: "20px 0" }}>No Gemini chats yet.</p>
                ) : (
                  geminiChats.map((c) => (
                    <div
                      key={c.id}
                      className="chat-item"
                      onClick={() => {
                        hasInitialSelected.current = true;
                        selectedIdRef.current = c.id;
                        setSelectedId(c.id);
                        setViewMode("split");
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <b style={{ fontSize: "13px" }}>{c.title}</b>
                          {c.has_images && <span style={{ fontSize: "10px", color: "#0284c7", fontWeight: 700 }}>🖼️ Pics & Files</span>}
                        </div>
                        <div className="meta" style={{ fontSize: "11px" }}>{c.messages} messages &bull; {formatRecentActivity(c.updated_at)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      ) : (
        /* MODE 1: SIDE-BY-SIDE ACTIVE CHAT (Exact Chronological Order with Pictures in Place) */
        <main className="app-chat-main">
          {activeChat ? (
            <div className="chat-view-container">
              {/* PINNED FIXED TOP SECTION - ALWAYS ON TOP, NEVER SCROLLS UP OR DOWN */}
              <div className="chat-pinned-top">
                {/* Active Chat Top Header */}
                <div className="chat-main-header">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span className={`source ${getBadgeClass(activeChat.source)}`}>{activeChat.source}</span>
                      <span style={{ fontSize: "11px", background: "rgba(47, 93, 80, 0.12)", color: "var(--moss)", padding: "2px 8px", borderRadius: "10px", fontWeight: 600 }}>
                        🔒 Uneditable History
                      </span>
                      <span className="meta" style={{ fontSize: "12px" }}>
                        &bull; {activeChat.messages.length} messages in chronological order
                      </span>
                    </div>
                    <h2 style={{ fontFamily: "Fraunces, Georgia, serif", margin: 0, fontSize: "20px" }}>
                      {activeChat.title}
                    </h2>
                  </div>

                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => download(`/chats/${activeChat.id}/export.md`, `${activeChat.title}.md`)}
                      style={{ fontSize: "12px", padding: "5px 10px" }}
                    >
                      Markdown
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => download(`/chats/${activeChat.id}/export.json`, `${activeChat.title}.json`)}
                      style={{ fontSize: "12px", padding: "5px 10px" }}
                    >
                      JSON
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => removeChat(activeChat.id)}
                      style={{ color: "var(--danger)", fontSize: "12px", padding: "5px 10px" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* PINNED CONTINUATION CARD: ALWAYS FIXED ON TOP, DOES NOT SCROLL UP OR DOWN */}
                <div className="chat-continuation-sticky-card">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px" }}>⚡</span>
                      <h3 style={{ margin: 0, fontFamily: "Fraunces, Georgia, serif", fontSize: "18px", color: "#0369a1" }}>
                        Which AI platform do you want to continue this conversation on?
                      </h3>
                    </div>
                    <span style={{ fontSize: "11px", background: "rgba(2, 132, 199, 0.12)", color: "#0284c7", padding: "2px 8px", borderRadius: "10px", fontWeight: 700 }}>
                      📌 Pinned on Top &bull; One-Click Handoff
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {TARGET_PLATFORMS.map((p) => {
                        const isCurrent = p.id === (activeChat.source || "").toLowerCase();
                        return (
                          <button
                            key={p.id}
                            className="btn"
                            type="button"
                            disabled={isLoadingHandoff}
                            onClick={() => continueWith(p.id)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "8px 14px",
                              fontSize: "12px",
                              fontWeight: 700,
                              background: p.id === "chatgpt" ? "#10a37f" : p.id === "claude" ? "#d97706" : "#2563eb",
                              color: "#ffffff",
                              border: "none",
                              borderRadius: "8px",
                              boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                              cursor: "pointer",
                            }}
                          >
                            <span>Continue on {p.label} →</span>
                            {isCurrent && (
                              <span style={{ fontSize: "10px", background: "rgba(255,255,255,0.25)", padding: "1px 6px", borderRadius: "6px", fontWeight: 600 }}>
                                Fresh Chat
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ flex: 1, minWidth: "240px", display: "flex", gap: "6px" }}>
                      <input
                        value={nextMessage}
                        onChange={(e) => setNextMessage(e.target.value)}
                        placeholder="Optional next message or question to pass along..."
                        style={{ padding: "8px 12px", fontSize: "12px", margin: 0, flex: 1, borderRadius: "8px", border: "1px solid #bae6fd" }}
                      />
                      <button
                        type="button"
                        className="btn"
                        title="Copy full context prompt to clipboard without opening a new tab — ideal if your account limit is over and you want to paste into a 2nd Claude account or incognito tab!"
                        onClick={async () => {
                          try {
                            const out = await api("/handoff", {
                              method: "POST",
                              body: JSON.stringify({
                                conversation_id: activeChat.id,
                                target: (activeChat.source || "claude").toLowerCase(),
                                next_message: nextMessage.trim() || null,
                              }),
                            });
                            await navigator.clipboard.writeText(out.prompt);
                            setCopiedPrompt(out.prompt);
                            setSelectedTarget(activeChat.source || "Claude");
                          } catch (err) {
                            alert("Could not copy prompt: " + err.message);
                          }
                        }}
                        style={{
                          fontSize: "11px",
                          padding: "6px 12px",
                          background: "#f1f5f9",
                          color: "#334155",
                          border: "1px solid #cbd5e1",
                          borderRadius: "8px",
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        📋 Copy for 2nd Account
                      </button>
                    </div>
                  </div>

                  {copiedPrompt && (
                    <div style={{ padding: "8px 14px", background: "rgba(47,93,80,0.1)", borderRadius: "8px", border: "1px solid var(--moss)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                        <b style={{ color: "#2f5d50", fontSize: "12px" }}>
                          ✓ Context copied to clipboard & {selectedTarget} opened!
                        </b>
                        <span style={{ fontSize: "11px", color: "var(--ink)", background: "rgba(255,255,255,0.7)", padding: "2px 8px", borderRadius: "6px" }}>
                          Tip: If {selectedTarget} input is not auto-filled, press <b>Ctrl + V</b> to paste!
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* SCROLLABLE CHAT MESSAGES BODY - ONLY THIS AREA SCROLLS */}
              <div className="chat-scrollable-body">
                <div className="chat-main-body">
                  {/* CHRONOLOGICAL CONVERSATION TRANSCRIPT HEADER */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 16px", borderBottom: "1px dashed var(--line)", paddingBottom: "10px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>📜</span> Previous Conversation History ({activeChat.messages.length} messages in exact chronological order)
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                      Turn 1 &rarr; Turn {activeChat.messages.length}
                    </span>
                  </div>

                  {/* Messages in Exact Chronological Order */}
                  <div className="thread" style={{ userSelect: "text", marginBottom: "32px" }}>
                  {activeChat.messages.map((m, i) => {
                    const segments = parseMessageSegments(m.content);
                    const isUser = m.role === "user";

                    return (
                      <div
                        key={i}
                        className={`bubble ${isUser ? "user" : "ai"}`}
                        style={{
                          maxWidth: "800px",
                          width: "fit-content",
                          minWidth: "260px",
                        }}
                      >
                        <div className="who" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                          <span style={{ fontWeight: 700, color: isUser ? "var(--ink)" : "#0e755b" }}>
                            {isUser ? "You (User)" : (activeChat.source ? activeChat.source.toUpperCase() : "AI Assistant")}
                          </span>
                          <span style={{ fontSize: "11px", opacity: 0.65 }}>
                            Turn #{i + 1} &bull; {isUser ? "Sent by you" : "Sent by AI"}
                          </span>
                        </div>

                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                          {segments.map((seg, sIdx) => {
                            if (seg.type === "image") {
                              return (
                                <div
                                  key={sIdx}
                                  style={{
                                    margin: "12px 0",
                                    background: isUser ? "rgba(0,0,0,0.05)" : "rgba(0,0,0,0.06)",
                                    border: "1px solid rgba(0,0,0,0.12)",
                                    borderRadius: "12px",
                                    padding: "12px",
                                    maxWidth: "500px",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      marginBottom: "8px",
                                      gap: "8px",
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <span style={{ fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                                      <span>🖼️</span> <span>{seg.alt}</span>
                                    </span>
                                    <div style={{ display: "flex", gap: "6px" }}>
                                      <button
                                        type="button"
                                        onClick={() => setZoomedImage({ src: seg.src, alt: seg.alt })}
                                        style={{
                                          background: isUser ? "#2f5d50" : "#0284c7",
                                          color: "#ffffff",
                                          border: "none",
                                          borderRadius: "6px",
                                          padding: "4px 10px",
                                          fontSize: "11px",
                                          cursor: "pointer",
                                          fontWeight: 700,
                                        }}
                                      >
                                        👁️ See Picture
                                      </button>
                                      <a
                                        href={seg.src}
                                        download={seg.alt + ".png"}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{
                                          background: "rgba(0,0,0,0.08)",
                                          color: "#1c1915",
                                          border: "1px solid rgba(0,0,0,0.2)",
                                          borderRadius: "6px",
                                          padding: "4px 8px",
                                          fontSize: "11px",
                                          textDecoration: "none",
                                          fontWeight: 500,
                                        }}
                                      >
                                        ⬇️ Open / Save
                                      </a>
                                    </div>
                                  </div>
                                  <img
                                    src={seg.src}
                                    alt={seg.alt}
                                    title="Click to see / zoom picture"
                                    onClick={() => setZoomedImage({ src: seg.src, alt: seg.alt })}
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                      const fb = e.currentTarget.nextElementSibling;
                                      if (fb) fb.style.display = "flex";
                                    }}
                                    style={{
                                      width: "100%",
                                      maxHeight: "360px",
                                      objectFit: "contain",
                                      borderRadius: "8px",
                                      boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
                                      cursor: "zoom-in",
                                      background: "#090d16",
                                      display: "block",
                                    }}
                                  />
                                  <div
                                    style={{
                                      display: "none",
                                      alignItems: "center",
                                      gap: "10px",
                                      padding: "12px",
                                      background: "rgba(2, 132, 199, 0.08)",
                                      border: "1.5px dashed rgba(2, 132, 199, 0.4)",
                                      borderRadius: "8px",
                                      marginTop: "6px",
                                    }}
                                  >
                                    <span style={{ fontSize: "24px" }}>🖼️</span>
                                    <div style={{ flex: 1 }}>
                                      <b style={{ fontSize: "12px", color: "#0369a1", display: "block" }}>{seg.alt}</b>
                                      <span style={{ fontSize: "11px", color: "var(--muted)" }}>Image URL is protected by the AI session origin. Click Open above to view.</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            if (seg.type === "image_placeholder") {
                              return (
                                <div
                                  key={sIdx}
                                  style={{
                                    margin: "10px 0",
                                    background: isUser ? "rgba(47, 93, 80, 0.08)" : "rgba(2, 132, 199, 0.08)",
                                    border: isUser ? "1.5px solid rgba(47, 93, 80, 0.3)" : "1.5px solid rgba(2, 132, 199, 0.3)",
                                    borderRadius: "12px",
                                    padding: "10px 14px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    maxWidth: "500px",
                                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: "42px",
                                      height: "42px",
                                      borderRadius: "8px",
                                      background: isUser ? "rgba(47, 93, 80, 0.15)" : "rgba(2, 132, 199, 0.15)",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "22px",
                                      flexShrink: 0,
                                    }}
                                  >
                                    🖼️
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      <b style={{ fontSize: "13px", color: isUser ? "#2f5d50" : "#0369a1" }}>
                                        {seg.name}
                                      </b>
                                      <span
                                        style={{
                                          fontSize: "10px",
                                          background: isUser ? "#2f5d50" : "#0284c7",
                                          color: "#fff",
                                          padding: "1px 6px",
                                          borderRadius: "6px",
                                          fontWeight: 700,
                                        }}
                                      >
                                        PICTURE
                                      </span>
                                    </div>
                                    <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                                      Picture attached in original {activeChat.source ? activeChat.source.toUpperCase() : "AI"} chat session
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            if (seg.type === "file") {
                              return (
                                <div
                                  key={sIdx}
                                  style={{
                                    margin: "10px 0",
                                    background: "#f8fafc",
                                    border: "1.5px solid #cbd5e1",
                                    borderRadius: "12px",
                                    padding: "10px 14px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "12px",
                                    maxWidth: "520px",
                                    boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                                    <div
                                      style={{
                                        width: "42px",
                                        height: "42px",
                                        borderRadius: "8px",
                                        background: "#e2e8f0",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "22px",
                                        flexShrink: 0,
                                      }}
                                    >
                                      {getFileIcon(seg.name)}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                        <b
                                          style={{
                                            fontSize: "13px",
                                            color: "#0f172a",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            maxWidth: "260px",
                                          }}
                                          title={seg.name}
                                        >
                                          {seg.name}
                                        </b>
                                        <span
                                          style={{
                                            fontSize: "10px",
                                            background: "#64748b",
                                            color: "#fff",
                                            padding: "1px 6px",
                                            borderRadius: "6px",
                                            fontWeight: 700,
                                          }}
                                        >
                                          FILE
                                        </span>
                                      </div>
                                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                                        Document attachment &bull; Preserved from conversation
                                      </div>
                                    </div>
                                  </div>
                                  {seg.url && (
                                    <a
                                      href={seg.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      download
                                      style={{
                                        background: "#0284c7",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: "6px",
                                        padding: "5px 12px",
                                        fontSize: "11px",
                                        fontWeight: 700,
                                        textDecoration: "none",
                                        whiteSpace: "nowrap",
                                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                                      }}
                                    >
                                      ⬇️ Open
                                    </a>
                                  )}
                                </div>
                              );
                            }

                            return <span key={sIdx}>{seg.value}</span>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
            <div style={{ margin: "auto", textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
              {loadingChat ? (
                <p>Loading conversation...</p>
              ) : (
                <>
                  <h3 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: "24px", color: "var(--ink)", margin: "0 0 8px" }}>
                    Select a conversation from the left
                  </h3>
                  <p style={{ margin: 0, fontSize: "14px" }}>
                    Your entire chat history from ChatGPT, Claude, and Gemini is available side-by-side.
                  </p>
                </>
              )}
            </div>
          )}
        </main>
      )}

      {/* Image Lightbox Modal */}
      {zoomedImage && (
        <div
          onClick={() => setZoomedImage(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.88)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "92vw",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              background: "#090d16",
              borderRadius: "16px",
              padding: "16px",
              border: "1.5px solid #0284c7",
              boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
            }}
          >
            <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", gap: "10px" }}>
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#38bdf8" }}>
                🖼️ {zoomedImage.alt || "Picture Preview"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <a
                  href={zoomedImage.src}
                  download={(zoomedImage.alt || "picture") + ".png"}
                  style={{
                    background: "#0284c7",
                    color: "#fff",
                    textDecoration: "none",
                    borderRadius: "8px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                  }}
                >
                  ⬇️ Download Picture
                </a>
                <button
                  type="button"
                  onClick={() => setZoomedImage(null)}
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    border: "none",
                    borderRadius: "50%",
                    width: "32px",
                    height: "32px",
                    fontSize: "16px",
                    color: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            <img
              src={zoomedImage.src}
              alt="Zoomed preview"
              style={{
                maxWidth: "100%",
                maxHeight: "75vh",
                borderRadius: "10px",
                display: "block",
                objectFit: "contain",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
