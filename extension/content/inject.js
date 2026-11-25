(() => {
  const currentAdapter =
    window.chatbridgeAdapter ||
    window.adapter ||
    (typeof adapter !== "undefined" ? adapter : null);

  if (!currentAdapter) return;

  const platformKey = (currentAdapter.source || "ai").toLowerCase();
  const platformName = platformKey === "chatgpt" ? "ChatGPT" : platformKey === "claude" ? "Claude" : "Gemini";

  function stripHandoffBoilerplate(text) {
    if (!text || typeof text !== "string") return "";
    if (!text.includes("=== UNEDITABLE")) return text;
    let cleaned = text.replace(/=== UNEDITABLE PREVIOUS CONVERSATION HISTORY.*?--- PREVIOUS CONVERSATION TRANSCRIPT ---\s*/gis, "");
    while (cleaned.includes("=== UNEDITABLE")) {
      cleaned = cleaned.replace(/=== UNEDITABLE PREVIOUS CONVERSATION HISTORY.*?--- PREVIOUS CONVERSATION TRANSCRIPT ---\s*/gis, "");
    }
    cleaned = cleaned.replace(/--- (?:END OF CONVERSATION|NEXT USER INSTRUCTION) ---.*?(?:Please continue|My next message \/ question:\s*)/gis, "");
    return cleaned.trim() || text;
  }

  // Replaces giant inline base64 image data with clean references for the prompt
  function cleanContentForPrompt(text) {
    if (!text) return "";
    text = stripHandoffBoilerplate(text);
    return text.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/gi, (match, alt) => {
      const cleanAlt = (alt || "Picture").trim();
      return `[Image Attachment: ${cleanAlt}]`;
    });
  }

  async function getPendingPromptData() {
    // 1. Query background service worker
    try {
      const bgResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "GET_PENDING_PROMPT", target: currentAdapter.source },
          (response) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(response);
          }
        );
      });
      if (bgResp && bgResp.ok && bgResp.prompt) {
        if (!bgResp.target || bgResp.target.toLowerCase() === platformKey) {
          return bgResp;
        }
      }
    } catch {}

    // 2. Fall back to local storage
    try {
      const storage = await chrome.storage.local.get([
        "pendingPrompt",
        "pendingTimestamp",
        "pendingMessages",
        "pendingNextMessage",
        "pendingTitle",
        "pendingTarget",
      ]);
      if (
        storage.pendingPrompt &&
        (!storage.pendingTimestamp || Date.now() - storage.pendingTimestamp < 30 * 60 * 1000)
      ) {
        if (!storage.pendingTarget || storage.pendingTarget.toLowerCase() === platformKey) {
          return {
            prompt: storage.pendingPrompt,
            title: storage.pendingTitle || "",
            messages: storage.pendingMessages || [],
            nextMessage: storage.pendingNextMessage || "",
            target: storage.pendingTarget || "",
          };
        }
      }
    } catch {}

    // 3. Fall back to querying the local ChatBridge backend directly
    try {
      let res;
      try {
        res = await fetch(`http://127.0.0.1:8000/handoff/latest?target=${currentAdapter.source}`);
      } catch {
        res = await fetch(`http://localhost:8000/handoff/latest?target=${currentAdapter.source}`);
      }
      if (res && res.ok) {
        const d = await res.json();
        if (d && d.prompt) {
          if (!d.target || d.target.toLowerCase() === platformKey) {
            return {
              prompt: d.prompt,
              title: d.title || "",
              messages: d.messages || [],
              nextMessage: d.next_message || "",
              target: d.target || "",
            };
          }
        }
      }
    } catch {}

    return null;
  }

  function parseMessagesFromPrompt(prompt) {
    const msgs = [];
    if (!prompt) return msgs;
    const lines = prompt.split("\n");
    let currentRole = "";
    let currentBlock = [];

    function flush() {
      if (currentBlock.length > 0 && currentRole) {
        msgs.push({
          role: currentRole.toLowerCase().includes("user") ? "user" : "assistant",
          content: currentBlock.join("\n").trim(),
        });
        currentBlock = [];
      }
    }

    for (const line of lines) {
      if (/^(?:User|Assistant|Turn #\d+ \((?:User|Assistant)\)):\s*/i.test(line)) {
        flush();
        currentRole = line.includes("User") ? "user" : "assistant";
        const rest = line.replace(/^(?:User|Assistant|Turn #\d+ \((?:User|Assistant)\)):\s*/i, "");
        if (rest) currentBlock.push(rest);
      } else if (!line.startsWith("===") && !line.startsWith("---")) {
        currentBlock.push(line);
      }
    }
    flush();
    return msgs;
  }

  function findEditor() {
    return (
      // ChatGPT specific (Lexical editor div or textarea)
      document.querySelector("#prompt-textarea") ||
      document.querySelector("div[id='prompt-textarea']") ||
      document.querySelector("div[contenteditable='true'][role='textbox']") ||
      document.querySelector("div[contenteditable='true'][data-placeholder*='Message']") ||
      document.querySelector("textarea[placeholder*='Message']") ||
      document.querySelector("textarea[placeholder*='Ask']") ||
      // Claude specific (ProseMirror contenteditable)
      document.querySelector(".ProseMirror[contenteditable='true']") ||
      document.querySelector("div.ProseMirror") ||
      document.querySelector("fieldset [contenteditable='true']") ||
      document.querySelector("[data-placeholder*='skills']") ||
      document.querySelector("[data-placeholder*='Claude']") ||
      document.querySelector("[data-placeholder*='Reply']") ||
      // Gemini specific (Quill contenteditable)
      document.querySelector("rich-textarea .ql-editor[contenteditable='true']") ||
      document.querySelector("div.ql-editor[contenteditable='true']") ||
      document.querySelector("rich-textarea [contenteditable='true']") ||
      document.querySelector("div[contenteditable='true'][aria-label*='prompt']") ||
      document.querySelector("div[contenteditable='true'][aria-label*='Enter a prompt']") ||
      document.querySelector("div.input-area [contenteditable='true']") ||
      // Generic fallbacks
      document.querySelector("div[role='textbox']") ||
      document.querySelector("div[contenteditable='true']") ||
      document.querySelector("textarea")
    );
  }

  // Safely inject text into editor across ChatGPT, Claude, and Gemini without crashing Lexical/React
  function injectTextIntoEditor(box, text) {
    if (!box || !text) return false;
    try {
      box.focus();
    } catch {}

    // 1. Textarea or Input element
    if (box.tagName === "TEXTAREA" || box.tagName === "INPUT" || "value" in box) {
      try {
        const proto = box.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
        if (descriptor && descriptor.set) {
          descriptor.set.call(box, text);
        } else {
          box.value = text;
        }
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch {}
    }

    // 2. Contenteditable div (ChatGPT Lexical, Claude ProseMirror, Gemini Quill)
    try {
      // First try native paste event (Lexical and ProseMirror built-in clipboard handler)
      let handled = false;
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        const pasteEvt = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        handled = !box.dispatchEvent(pasteEvt);
      } catch {}

      if (!handled) {
        // Fallback: beforeinput event
        try {
          const inputEvt = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: text,
          });
          handled = !box.dispatchEvent(inputEvt);
        } catch {}
      }

      if (!handled) {
        // Fallback: selection + execCommand
        try {
          const sel = window.getSelection();
          if (sel) {
            const p = box.querySelector("p") || box.lastElementChild || box;
            const range = document.createRange();
            range.selectNodeContents(p);
            range.collapse(false); // caret at the end
            sel.removeAllRanges();
            sel.addRange(range);
          }
          document.execCommand("insertText", false, text);
          handled = true;
        } catch {}
      }

      box.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    } catch (err) {
      console.warn("[ChatBridge] Editor injection notice:", err);
    }

    return false;
  }

  function showPictureGalleryModal(images) {
    let modal = document.getElementById("chatbridge-gallery-modal");
    if (modal) {
      modal.remove();
      return;
    }

    modal = document.createElement("div");
    modal.id = "chatbridge-gallery-modal";
    modal.style.cssText =
      "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.88); z-index: 9999999999; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; backdrop-filter: blur(4px);";

    modal.innerHTML = `
      <div style="background: #090d16; border: 1.5px solid #0284c7; border-radius: 16px; width: 90%; max-width: 850px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.85);">
        <div style="padding: 14px 20px; background: #1e293b; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">🖼️</span>
            <b style="font-size: 15px; color: #38bdf8;">Attached Pictures & Wallpapers (${images.length})</b>
          </div>
          <button id="chatbridge-gallery-close" style="background: none; border: none; color: #cbd5e1; font-size: 20px; cursor: pointer; padding: 4px;">✕</button>
        </div>
        <div style="padding: 20px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; background: #090d16;">
          ${images
            .map(
              (img) => `
            <div style="background: #1e293b; border-radius: 12px; padding: 10px; border: 1px solid rgba(255,255,255,0.15); display: flex; flex-direction: column; align-items: center;">
              <img src="${img.src}" alt="${img.alt}" style="width: 100%; height: 200px; object-fit: contain; border-radius: 8px; background: #000; cursor: pointer;" onclick="window.open(this.src, '_blank')" title="Click to open original in new tab" />
              <div style="margin-top: 8px; font-size: 12px; font-weight: 600; color: #f1f5f9; text-align: center; word-break: break-all;">${img.alt}</div>
              <a href="${img.src}" download="${img.alt}.png" target="_blank" style="margin-top: 6px; font-size: 11px; color: #38bdf8; text-decoration: none; font-weight: 600;">⬇️ Open / Save Full Picture</a>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById("chatbridge-gallery-close")?.addEventListener("click", () => modal.remove());
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
  }

  function renderMessageBubbles(msgsList, container, startIndex, prepend = false) {
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < msgsList.length; i++) {
      const m = msgsList[i];
      const isUser = m.role === "user";
      const turnNum = startIndex + i + 1;

      const bubble = document.createElement("div");
      bubble.style.cssText = `max-width: 88%; padding: 12px 16px; border-radius: 14px; line-height: 1.6; font-size: 13px; user-select: text; ${
        isUser
          ? "align-self: flex-end; background: #1d4ed8; color: #ffffff;"
          : "align-self: flex-start; background: #1e293b; color: #f1f5f9; border: 1px solid rgba(255,255,255,0.12);"
      }`;

      const who = document.createElement("div");
      who.style.cssText =
        "font-size: 10.5px; font-weight: 700; opacity: 0.85; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; justify-content: space-between; gap: 12px;";
      who.innerHTML = `
        <span>${isUser ? "You (User)" : "AI Assistant"}</span>
        <span style="opacity: 0.7;">Turn #${turnNum}</span>
      `;
      bubble.appendChild(who);

      const contentDiv = document.createElement("div");
      contentDiv.style.whiteSpace = "pre-wrap";

      const contentStr = m.content || "";
      const imgRegex = /!\[([^\]]*)\]\(((?:data:image\/[^;]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+))\)/gi;
      let lastIndex = 0;
      let match;

      while ((match = imgRegex.exec(contentStr)) !== null) {
        if (match.index > lastIndex) {
          const txt = document.createElement("span");
          txt.textContent = contentStr.slice(lastIndex, match.index);
          contentDiv.appendChild(txt);
        }

        const imgAlt = match[1] || "Picture";
        const imgSrc = match[2];

        const imgWrapper = document.createElement("div");
        imgWrapper.style.cssText =
          "margin: 10px 0; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.18); border-radius: 12px; padding: 10px;";

        const imgBar = document.createElement("div");
        imgBar.style.cssText =
          "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;";
        imgBar.innerHTML = `
          <span style="font-size: 11.5px; font-weight: 600; color: #f1f5f9; display: flex; align-items: center; gap: 6px;">
            <span>🖼️</span> <b>${imgAlt}</b>
          </span>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="cb-btn-see" style="background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-weight: 600;">
              👁️ See Picture
            </button>
            <a href="${imgSrc}" download="${imgAlt}.png" target="_blank" style="background: rgba(255,255,255,0.15); color: #fff; border: 1px solid rgba(255,255,255,0.25); border-radius: 6px; padding: 3px 8px; font-size: 11px; text-decoration: none;">
              ⬇️ Save
            </a>
          </div>
        `;
        imgWrapper.appendChild(imgBar);

        const imgEl = document.createElement("img");
        imgEl.src = imgSrc;
        imgEl.alt = imgAlt;
        imgEl.title = "Click to see / zoom picture";
        imgEl.style.cssText =
          "width: 100%; max-height: 280px; object-fit: contain; border-radius: 8px; display: block; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 14px rgba(0,0,0,0.5); cursor: zoom-in; background: #000;";

        imgEl.onclick = () => showPictureGalleryModal([{ alt: imgAlt, src: imgSrc }]);
        imgBar.querySelector(".cb-btn-see")?.addEventListener("click", () => {
          showPictureGalleryModal([{ alt: imgAlt, src: imgSrc }]);
        });

        imgWrapper.appendChild(imgEl);
        contentDiv.appendChild(imgWrapper);
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < contentStr.length) {
        const txt = document.createElement("span");
        txt.textContent = contentStr.slice(lastIndex);
        contentDiv.appendChild(txt);
      }

      // Parse and display any file attachment tags (PDF, Python, Docs)
      const fileRegex = /\[(?:📁\s*)?([^\]]+)\]\(([^)]+)\)|\[(?:📁\s*)?Attached File:\s*([^\]]+)\]/gi;
      let fMatch;
      while ((fMatch = fileRegex.exec(contentStr)) !== null) {
        const fileName = (fMatch[1] || fMatch[3] || "Document").trim();
        const fileUrl = fMatch[2] || null;
        if (fileName && !fileName.toLowerCase().includes("image attachment") && !fileName.toLowerCase().includes("picture")) {
          const fileBox = document.createElement("div");
          fileBox.style.cssText =
            "margin: 8px 0; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px;";
          fileBox.innerHTML = `
            <span style="font-size: 12px; font-weight: 600; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
              <span>📁</span> <b>${fileName}</b>
            </span>
            ${
              fileUrl
                ? `<a href="${fileUrl}" target="_blank" download style="background: #2563eb; color: #fff; padding: 3px 8px; border-radius: 6px; font-size: 11px; text-decoration: none; font-weight: 600;">⬇️ Open File</a>`
                : `<span style="font-size: 10.5px; opacity: 0.7; color: #94a3b8;">Preserved File</span>`
            }
          `;
          contentDiv.appendChild(fileBox);
        }
      }

      bubble.appendChild(contentDiv);
      fragment.appendChild(bubble);
    }

    if (prepend && container.firstChild) {
      container.insertBefore(fragment, container.firstChild);
    } else {
      container.appendChild(fragment);
    }
  }

  // Render the uneditable read-only container across ALL 3 platforms (ChatGPT, Claude, Gemini)
  let isRenderingHistory = false;

  function renderUneditableHistory(handoffData) {
    if (isRenderingHistory) return null;

    let container = document.getElementById("chatbridge-inline-history");
    if (container) return container;

    if (!document.body) return null;

    isRenderingHistory = true;
    try {
      let msgs = handoffData.messages || [];
      if (!Array.isArray(msgs) || msgs.length === 0) {
        msgs = parseMessagesFromPrompt(handoffData.prompt);
      }

      // Collect all images from the prompt / messages for quick gallery preview
      const images = [];
      const textToSearch = handoffData.prompt || "";
      const imgRegex = /!\[([^\]]*)\]\(((?:data:image\/[^;]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+))\)/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(textToSearch)) !== null) {
        if (!images.some((im) => im.src === imgMatch[2])) {
          images.push({ alt: imgMatch[1] || "Picture", src: imgMatch[2] });
        }
      }

      container = document.createElement("div");
      container.id = "chatbridge-inline-history";
      container.setAttribute("data-chatbridge", "locked-history");
      container.setAttribute("contenteditable", "false");

      // Responsive transition styles
      container.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        width: min(880px, calc(100vw - 32px));
        max-height: 500px;
        z-index: 99999999;
        background: #090d16;
        border: 2px solid #0284c7;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,0.85);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #f8fafc;
        user-select: text;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      `;

      // 1. Header with clear Collapse / Expand button
      const header = document.createElement("div");
      header.id = "cb-history-header";
      header.style.cssText =
        "background: #0f172a; padding: 12px 18px; border-bottom: 1.5px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;";
      header.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" id="cb-header-title-area">
          <span style="font-size: 20px;">🔒</span>
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <b style="font-size: 13.5px; color: #38bdf8;">Uneditable Previous Conversation History (Read-Only)</b>
              <span style="font-size: 10px; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid #0284c7; padding: 2px 7px; border-radius: 8px; font-weight: 700;">
                LOCKED
              </span>
            </div>
            <div id="cb-history-subtitle" style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">
              Preserved from <b>${handoffData.title || "ChatBridge"}</b> &bull; ${msgs.length} messages in exact chronological sequence
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${
            images.length > 0
              ? `<button id="cb-quick-pics-btn" type="button" style="background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer;">🖼️ Pics (${images.length})</button>`
              : ""
          }
          <button id="cb-toggle-history" type="button" style="background: #0284c7; color: #fff; border: none; border-radius: 10px; padding: 5px 14px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">
            Collapse ▲
          </button>
          <button id="cb-dismiss-history" type="button" style="background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; padding: 2px 6px; line-height: 1;" title="Dismiss history view">
            ✕
          </button>
        </div>
      `;
      container.appendChild(header);

      // 2. Scrollable Message Thread
      const msgList = document.createElement("div");
      msgList.id = "chatbridge-msg-list";
      msgList.setAttribute("contenteditable", "false");
      msgList.style.cssText =
        "max-height: 350px; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: #090d16;";

      const isLongConvo = msgs.length > 20;
      let displayMsgs = msgs;
      let earlierCount = 0;
      if (isLongConvo) {
        earlierCount = msgs.length - 20;
        displayMsgs = msgs.slice(-20);

        const expandEarlierDiv = document.createElement("div");
        expandEarlierDiv.style.cssText = "text-align: center; padding: 6px 0;";
        expandEarlierDiv.innerHTML = `
          <button id="cb-show-earlier" style="background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); border-radius: 20px; padding: 6px 16px; font-size: 12px; font-weight: 600; cursor: pointer;">
            📜 Show earlier conversation (+${earlierCount} earlier turns)
          </button>
        `;
        msgList.appendChild(expandEarlierDiv);

        expandEarlierDiv.querySelector("#cb-show-earlier")?.addEventListener("click", () => {
          expandEarlierDiv.remove();
          renderMessageBubbles(msgs.slice(0, earlierCount), msgList, 0, true);
        });
      }

      renderMessageBubbles(displayMsgs, msgList, earlierCount, false);
      container.appendChild(msgList);

      // 3. Footer with status and Re-insert button
      const footer = document.createElement("div");
      footer.id = "cb-history-footer";
      footer.style.cssText =
        "background: #0f172a; padding: 10px 18px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: #94a3b8; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;";
      footer.innerHTML = `
        <span id="cb-footer-note">🔒 <b>Read-only history:</b> The messages and attachments above cannot be edited or erased.</span>
        <button id="cb-reinsert-btn" type="button" style="background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px;">
          📋 Insert Context into ${platformName} ↓
        </button>
      `;
      container.appendChild(footer);

      // Mount directly into document.body (safe from React virtual DOM reconciliation)
      document.body.appendChild(container);

      // Collapse and Expand State Management
      let isCollapsed = false;

      function setCollapsedState(collapse) {
        isCollapsed = collapse;
        const toggleBtn = document.getElementById("cb-toggle-history");
        const subtitle = document.getElementById("cb-history-subtitle");
        const quickPicsBtn = document.getElementById("cb-quick-pics-btn");

        if (isCollapsed) {
          // Collapse into a sleek floating pill docked in the bottom-right corner!
          // NEVER BLOCKS THE CENTER CHAT INPUT TEXTAREA!
          msgList.style.display = "none";
          footer.style.display = "none";
          if (subtitle) subtitle.style.display = "none";
          if (quickPicsBtn) quickPicsBtn.style.display = "none";

          container.style.bottom = "80px";
          container.style.right = "24px";
          container.style.left = "auto";
          container.style.transform = "none";
          container.style.width = "auto";
          container.style.maxWidth = "460px";
          container.style.borderRadius = "24px";
          container.style.border = "1.5px solid #0284c7";
          container.style.boxShadow = "0 8px 24px rgba(0,0,0,0.75)";

          header.style.padding = "8px 14px";
          header.style.background = "#090d16";
          header.style.borderBottom = "none";

          if (toggleBtn) {
            toggleBtn.innerHTML = `Expand ▼ (${msgs.length} turns)`;
            toggleBtn.style.background = "#0284c7";
            toggleBtn.style.padding = "4px 10px";
          }
        } else {
          // Expand into the full-width centered reading view
          msgList.style.display = "flex";
          footer.style.display = "flex";
          if (subtitle) subtitle.style.display = "block";
          if (quickPicsBtn) quickPicsBtn.style.display = "inline-block";

          container.style.bottom = "90px";
          container.style.left = "50%";
          container.style.right = "auto";
          container.style.transform = "translateX(-50%)";
          container.style.width = "min(880px, calc(100vw - 32px))";
          container.style.maxWidth = "none";
          container.style.borderRadius = "16px";
          container.style.border = "2px solid #0284c7";
          container.style.boxShadow = "0 20px 60px rgba(0,0,0,0.85)";

          header.style.padding = "12px 18px";
          header.style.background = "#0f172a";
          header.style.borderBottom = "1.5px solid rgba(255,255,255,0.12)";

          if (toggleBtn) {
            toggleBtn.innerHTML = "Collapse ▲";
            toggleBtn.style.background = "#0284c7";
            toggleBtn.style.padding = "5px 14px";
          }
        }
      }

      document.getElementById("cb-toggle-history")?.addEventListener("click", (e) => {
        e.stopPropagation();
        setCollapsedState(!isCollapsed);
      });

      document.getElementById("cb-header-title-area")?.addEventListener("click", () => {
        if (isCollapsed) setCollapsedState(false);
      });

      document.getElementById("cb-dismiss-history")?.addEventListener("click", (e) => {
        e.stopPropagation();
        container.remove();
      });

      if (images.length > 0) {
        document.getElementById("cb-quick-pics-btn")?.addEventListener("click", (e) => {
          e.stopPropagation();
          showPictureGalleryModal(images);
        });
      }

      document.getElementById("cb-reinsert-btn")?.addEventListener("click", () => {
        const box = findEditor();
        const cleanPrompt = cleanContentForPrompt(handoffData.prompt);
        const footerNote = document.getElementById("cb-footer-note");
        const reinsertBtn = document.getElementById("cb-reinsert-btn");

        if (box) {
          injectTextIntoEditor(box, cleanPrompt);
          if (reinsertBtn) reinsertBtn.innerText = `✓ Inserted into ${platformName}!`;
          if (footerNote) footerNote.innerHTML = "✓ <b>Prompt Ready!</b> Press Enter to continue conversation.";
        } else {
          try {
            navigator.clipboard.writeText(cleanPrompt);
          } catch {}
          if (reinsertBtn) reinsertBtn.innerText = "✓ Copied to Clipboard!";
          if (footerNote) footerNote.innerHTML = "✓ <b>Copied to Clipboard!</b> Click the input box and press Ctrl+V.";
        }
      });

      return container;
    } finally {
      isRenderingHistory = false;
    }
  }

  // Main execution
  (async () => {
    let data = null;
    // Retry finding pending prompt for up to 20 attempts (~6 seconds)
    for (let a = 0; a < 20; a++) {
      data = await getPendingPromptData();
      if (data && data.prompt) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    if (!data || !data.prompt) return;

    // Clean any bloated base64 or nested boilerplate from prompt
    const cleanPrompt = cleanContentForPrompt(data.prompt);

    // Pre-copy clean prompt to clipboard for instant 1-click Ctrl+V
    try {
      navigator.clipboard.writeText(cleanPrompt);
    } catch {}

    // AUTOMATICALLY MOUNT THE UNEDITABLE HISTORY CARD (UPSIDE)
    renderUneditableHistory(data);

    // Wait for DOM to mount editor, then gently focus it WITHOUT filling it with duplicate text
    // The user's input box stays 100% clean and ready to type
    let pollCount = 0;
    const maxPolls = 30; // ~9 seconds

    const pollInterval = setInterval(() => {
      pollCount++;
      if (pollCount > maxPolls) {
        clearInterval(pollInterval);
        return;
      }

      const box = findEditor();
      if (box) {
        clearInterval(pollInterval);
        setTimeout(() => {
          try {
            box.focus();
          } catch {}
        }, 400);
      }
    }, 300);
  })();
})();
