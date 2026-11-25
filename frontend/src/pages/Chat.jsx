import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { download } from "../download";

const PLATFORMS = [
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

export default function Chat() {
  const { id } = useParams();
  const [chat, setChat] = useState(null);
  const [status, setStatus] = useState("");
  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [nextMessage, setNextMessage] = useState("");
  const [isLoadingHandoff, setIsLoadingHandoff] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState("checking");
  const [zoomedImage, setZoomedImage] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    api(`/chats/${id}`).then(setChat).catch(() => setChat(false));
  }, [id]);

  useEffect(() => {
    function checkExtension() {
      const el = document.getElementById("chatbridge-extension-installed");
      if (el) {
        const v = el.dataset.version || "";
        setExtensionStatus(v.startsWith("0.2") || v.startsWith("0.3") ? "ready" : "outdated");
      } else {
        setExtensionStatus("not-detected");
      }
    }
    checkExtension();
    const interval = setInterval(checkExtension, 1200);
    return () => clearInterval(interval);
  }, []);

  async function continueWith(targetId) {
    const targetObj = PLATFORMS.find((p) => p.id === targetId);
    const platformName = targetObj ? targetObj.label : targetId;
    setSelectedPlatform(platformName);
    setStatus("Preparing conversation context...");
    setIsLoadingHandoff(true);

    try {
      const out = await api("/handoff", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: Number(id),
          target: targetId,
          next_message: nextMessage.trim() || null,
        }),
      });

      setCopiedPrompt(out.prompt);
      setTargetUrl(out.url);

      // 1. Copy next message or prompt to system clipboard only as needed
      // (Avoids ChatGPT popping up "wants to see text and images copied to clipboard" dialog)
      try {
        if (nextMessage.trim()) {
          await navigator.clipboard.writeText(nextMessage.trim());
        }
      } catch (e) {}

      // 2. Multi-channel transfer to extension
      try {
        localStorage.setItem("chatbridge_pending_prompt", out.prompt);
        localStorage.setItem("chatbridge_pending_target", targetId);
      } catch {}

      try {
        window.postMessage(
          { type: "CHATBRIDGE_SET_PROMPT", prompt: out.prompt, target: targetId },
          "*"
        );
      } catch {}

      try {
        window.dispatchEvent(
          new CustomEvent("chatbridge:set-prompt", {
            detail: { prompt: out.prompt, target: targetId },
          })
        );
        document.dispatchEvent(
          new CustomEvent("chatbridge:set-prompt", {
            detail: { prompt: out.prompt, target: targetId },
          })
        );
      } catch {}

      try {
        let transfer = document.getElementById("chatbridge-prompt-transfer");
        if (!transfer) {
          transfer = document.createElement("div");
          transfer.id = "chatbridge-prompt-transfer";
          transfer.style.display = "none";
          document.documentElement.appendChild(transfer);
        }
        transfer.dataset.target = targetId;
        transfer.textContent = out.prompt;
      } catch {}

      // 3. Short delay to ensure storage writes complete in extension service worker before opening new tab
      await new Promise((r) => setTimeout(r, 250));

      // 4. Open target site in new tab
      window.open(out.url, "_blank");

      setStatus(
        `Ready! Context from ${out.kept} messages has been copied to your clipboard. A new tab for ${platformName} was opened.`
      );
    } catch (e) {
      setStatus("Could not prepare handoff: " + e.message);
    } finally {
      setIsLoadingHandoff(false);
    }
  }

  async function copyAgain() {
    if (copiedPrompt) {
      try {
        await navigator.clipboard.writeText(copiedPrompt);
        alert("Prompt copied to clipboard! You can paste it into the message box with Ctrl+V.");
      } catch {
        alert("Please select and copy the prompt text from the box below.");
      }
    }
  }

  async function remove() {
    if (!window.confirm("Delete this chat from ChatBridge?")) return;
    await api(`/chats/${id}`, { method: "DELETE" });
    nav("/");
  }

  if (chat === null) return <p className="shell">Loading conversation...</p>;
  if (chat === false) {
    return (
      <div className="shell">
        <p>Conversation not found.</p>
        <Link to="/" className="btn">Back to your chats</Link>
      </div>
    );
  }

  function getBadgeClass(source) {
    const s = (source || "").toLowerCase();
    if (s.includes("chatgpt")) return "badge-chatgpt";
    if (s.includes("claude")) return "badge-claude";
    if (s.includes("gemini")) return "badge-gemini";
    return "badge-default";
  }

  return (
    <div className="shell">
      <div className="topbar">
        <Link className="brand" to="/">
          <span className="wordmark">ChatBridge</span>
        </Link>
        <div className="nav">
          <Link to="/">← All chats</Link>
          <button className="ghost" type="button" onClick={() => download(`/chats/${id}/export.md`, `${chat.title}.md`)}>
            Markdown
          </button>
          <button className="ghost" type="button" onClick={() => download(`/chats/${id}/export.txt`, `${chat.title}.txt`)}>
            Text
          </button>
          <button className="ghost" type="button" onClick={() => download(`/chats/${id}/export.json`, `${chat.title}.json`)}>
            JSON
          </button>
          <button className="ghost" type="button" onClick={remove} style={{ color: "var(--danger)" }}>
            Delete
          </button>
        </div>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <span className={`source ${getBadgeClass(chat.source)}`}>{chat.source}</span>
        <h2 style={{ fontFamily: "Fraunces, Georgia, serif", margin: "4px 0 6px" }}>{chat.title}</h2>
        <div className="meta" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span>{chat.messages.length} messages in chronological order</span>
          <span style={{ fontSize: "11px", background: "rgba(47, 93, 80, 0.12)", color: "var(--moss)", padding: "3px 10px", borderRadius: "12px", fontWeight: 600 }}>
            🔒 Uneditable (Read-Only) History
          </span>
          {chat.updated_at && <span>• Recent activity: {formatRecentActivity(chat.updated_at)}</span>}
        </div>
      </div>

      {/* Messages Thread In Exact Chronological Order */}
      <div className="thread" style={{ userSelect: "text", marginBottom: "32px" }}>
        {chat.messages.map((m, i) => {
          // Parse content for markdown images: ![alt](url)
          const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
          const segments = [];
          const msgImages = [];
          let lastIdx = 0;
          let match;

          while ((match = imgRegex.exec(m.content)) !== null) {
            if (match.index > lastIdx) {
              segments.push({ type: "text", value: m.content.slice(lastIdx, match.index) });
            }
            const imgData = { alt: match[1] || "Attached Picture", src: match[2] };
            segments.push({ type: "image", ...imgData });
            msgImages.push(imgData);
            lastIdx = match.index + match[0].length;
          }
          if (lastIdx < m.content.length) {
            segments.push({ type: "text", value: m.content.slice(lastIdx) });
          }

          return (
            <div key={i} className={`bubble ${m.role === "user" ? "user" : "ai"}`} style={{ position: "relative" }}>
              <div className="who" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700 }}>
                  {m.role === "user" ? "You (User)" : (chat.source ? chat.source.toUpperCase() : "AI Assistant")}
                </span>
                <span style={{ fontSize: "10px", opacity: 0.7, fontWeight: "normal" }}>
                  Message #{i + 1} &bull; {m.role === "user" ? "Sent by you" : "Sent by AI"}
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
                          background: m.role === "user" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)",
                          border: m.role === "user" ? "1px solid rgba(255,255,255,0.25)" : "1px solid rgba(0,0,0,0.15)",
                          borderRadius: "12px",
                          padding: "12px",
                          maxWidth: "460px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>🖼️</span> <span>{seg.alt}</span>
                          </span>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={() => setZoomedImage({ src: seg.src, alt: seg.alt })}
                              style={{
                                background: m.role === "user" ? "#ffffff" : "#2f5d50",
                                color: m.role === "user" ? "#1e3a8a" : "#ffffff",
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
                              style={{
                                background: "rgba(0,0,0,0.08)",
                                color: m.role === "user" ? "#ffffff" : "#333333",
                                border: m.role === "user" ? "1px solid rgba(255,255,255,0.4)" : "1px solid #ccc",
                                borderRadius: "6px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                textDecoration: "none",
                                fontWeight: 500,
                                display: "inline-flex",
                                alignItems: "center",
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
                          style={{
                            width: "100%",
                            maxHeight: "360px",
                            objectFit: "contain",
                            borderRadius: "8px",
                            boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
                            border: "1px solid rgba(0,0,0,0.1)",
                            cursor: "zoom-in",
                            background: "#090d16",
                            display: "block",
                          }}
                        />
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

      {/* Continuation Card (At the bottom of the conversation thread) */}
      <div className="card stack" style={{ marginBottom: "32px", border: "2px solid #e4d8c6" }}>
        <h3 style={{ margin: 0, fontFamily: "Fraunces, Georgia, serif", fontSize: "20px" }}>
          Continue this conversation on another AI
        </h3>
        <p className="meta" style={{ margin: 0 }}>
          ChatBridge packages this complete uneditable conversation history (including all pictures) so you can continue seamlessly.
        </p>

        <div>
          <label style={{ fontSize: "12px", fontWeight: 600, display: "block", marginBottom: "4px" }}>
            Optional next message or question
          </label>
          <input
            value={nextMessage}
            onChange={(e) => setNextMessage(e.target.value)}
            placeholder="e.g. Now give me a step-by-step implementation plan..."
          />
        </div>

        {extensionStatus !== "ready" && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <span>
              ⚡ <b>Ensure clean uneditable history:</b> Open <code>chrome://extensions</code> and click <b>⟳ Reload</b> on ChatBridge (v0.3.7).
            </span>
            <span style={{ fontSize: "11px", fontWeight: 600 }}>v0.3.7 Ready</span>
          </div>
        )}

        <div className="row" style={{ marginTop: "4px" }}>
          {PLATFORMS.map((p) => (
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
                padding: "10px 18px",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              Continue on {p.label} &rarr;
            </button>
          ))}
        </div>

        {copiedPrompt && (
          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              background: "rgba(47, 93, 80, 0.08)",
              border: "1px solid var(--moss)",
              marginTop: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
              <b style={{ color: "#2f5d50", fontSize: "14px" }}>
                ✓ Context prepared & copied to your clipboard!
              </b>
              <div className="row" style={{ gap: "8px" }}>
                <button className="btn" type="button" onClick={copyAgain} style={{ fontSize: "12px", padding: "6px 12px" }}>
                  📋 Copy context again
                </button>
                {targetUrl && (
                  <a href={targetUrl} target="_blank" rel="noreferrer" className="ghost" style={{ fontSize: "12px", padding: "6px 12px", textDecoration: "underline" }}>
                    Re-open {selectedPlatform} &rarr;
                  </a>
                )}
              </div>
            </div>

            <div style={{ background: "#ffffff", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--line)", fontSize: "13px", lineHeight: "1.6", marginTop: "8px" }}>
              <b>How to continue in {selectedPlatform}:</b>
              <ol style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
                <li>Look at your newly opened <b>{selectedPlatform}</b> tab. The uneditable history card will display above your chat composer with all pictures and Collapse/Expand controls.</li>
                <li>Your chat input box stays clean and ready so you can type your next question directly without duplicate text.</li>
                <li>If you ever want to paste the full context into the chat box, simply click <b>📋 Insert Context Below</b> on the history card, or press <b>Ctrl+V</b>!</li>
              </ol>
            </div>

            <details style={{ marginTop: "10px" }}>
              <summary style={{ fontSize: "12px", color: "var(--muted)", cursor: "pointer", fontWeight: 500 }}>
                View generated handoff prompt text
              </summary>
              <textarea
                readOnly
                value={copiedPrompt}
                rows={8}
                style={{ marginTop: "8px", fontSize: "12px", fontFamily: "monospace", width: "100%", background: "#fafafa" }}
              />
            </details>
          </div>
        )}
      </div>

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
                🖼️ {typeof zoomedImage === "object" ? zoomedImage.alt : "Picture Preview"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <a
                  href={typeof zoomedImage === "object" ? zoomedImage.src : zoomedImage}
                  download={(typeof zoomedImage === "object" ? zoomedImage.alt : "picture") + ".png"}
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
              src={typeof zoomedImage === "object" ? zoomedImage.src : zoomedImage}
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
