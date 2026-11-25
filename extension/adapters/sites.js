function isIgnoredUI(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length === 0) return true;
  if (/^ChatGPT can make mistakes/i.test(t)) return true;
  if (/^Thinking effort\s*(?:Auto|Instant|Medium|High)?$/i.test(t)) return true;
  if (/^(?:Latest response|Regenerate|Copy|Share|Read aloud|Good response|Bad response)$/i.test(t)) return true;
  return false;
}

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

function cleanMessageText(text) {
  let cleaned = text
    .replace(/^(?:You|ChatGPT) said:\s*/i, "")
    .replace(/\n?(?:Copy|Edit|Share|Read aloud|Bad response|Good response)\s*$/i, "")
    .trim();
  return stripHandoffBoilerplate(cleaned);
}

function getElementImageBase64(img) {
  try {
    if (!img) return "";
    const src = img.getAttribute("src") || img.src || "";
    if (!src) return "";
    if (src.startsWith("data:image")) return src;

    // Convert local blob URLs so they survive tab closure
    if (src.startsWith("blob:")) {
      const canvas = document.createElement("canvas");
      let w = img.naturalWidth || img.width || 400;
      let h = img.naturalHeight || img.height || 400;
      const maxDim = 800;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.82);
    }
    // Standard web URL (e.g. OpenAI / Claude CDN): return directly without expensive canvas overhead
    return src;
  } catch (err) {
    return img.src || "";
  }
}

function extractMessageContent(containerNode) {
  if (!containerNode) return "";

  // 1. Extract all content images (user uploaded pictures & AI generated pictures)
  const imgEls = [...containerNode.querySelectorAll("img")];
  const foundImages = [];

  for (const img of imgEls) {
    const src = img.getAttribute("src") || img.src || "";
    if (!src) continue;

    // Ignore tiny icons, avatars, system svgs, emojis
    if (
      src.startsWith("data:image/svg+xml") ||
      src.includes("/avatar") ||
      src.includes("profile") ||
      src.includes("favicon") ||
      src.includes("icon") ||
      src.includes("google_logo")
    ) {
      continue;
    }

    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (w > 0 && w < 30 && h > 0 && h < 30) continue;

    // Find image title/alt or filename
    let alt = (img.getAttribute("alt") || img.alt || "").trim();
    if (!alt || alt.toLowerCase() === "image" || alt.toLowerCase() === "uploaded image") {
      const parentText = (img.parentElement?.innerText || img.closest("div")?.innerText || "").trim();
      const match = parentText.match(/([a-zA-Z0-9_\-\.\s]+\.(?:png|jpg|jpeg|gif|webp|bmp))/i);
      alt = match ? match[1] : "Picture";
    }

    // Convert to permanent base64 data URL so it never expires and renders anywhere
    const permanentSrc = getElementImageBase64(img);
    if (permanentSrc && !foundImages.some((item) => item.src === permanentSrc)) {
      foundImages.push({ src: permanentSrc, alt });
    }
  }

  // 2. Also check for image attachment links (<a> tags with image hrefs)
  const linkEls = [
    ...containerNode.querySelectorAll(
      "a[href*='.png'], a[href*='.jpg'], a[href*='.jpeg'], a[href*='.webp'], a[download]"
    ),
  ];
  for (const a of linkEls) {
    const href = a.getAttribute("href") || a.href || "";
    if (href && !foundImages.some((img) => img.src === href)) {
      const linkText = a.innerText.trim() || a.getAttribute("download") || "Attached image";
      foundImages.push({ src: href, alt: linkText });
    }
  }

  // 3. Extract file attachments (PDFs, code files, documents, archives)
  const foundFiles = [];
  const fileEls = [
    ...containerNode.querySelectorAll(
      "a[href*='.pdf'], a[href*='.docx'], a[href*='.doc'], a[href*='.csv'], a[href*='.xlsx'], a[href*='.py'], a[href*='.txt'], a[href*='.zip'], a[href*='.json'], [data-testid*='attachment'], [data-testid*='file'], [data-testid*='file-pill'], div[class*='FileThumbnail'], div[class*='FileSnippet'], mat-chip[class*='attachment'], .attachment-chip, .file-pill"
    ),
  ];
  for (const el of fileEls) {
    const link = el.tagName === "A" ? el : el.querySelector("a");
    const href = link?.getAttribute("href") || link?.href || "";
    const rawName = (el.innerText || el.getAttribute("download") || el.getAttribute("aria-label") || "").trim();
    const extMatch = rawName.match(/([a-zA-Z0-9_\-\.\s]+\.(?:pdf|docx?|xlsx?|csv|txt|py|js|ts|json|zip|tar|gz|cpp|c|java|html|css))/i);
    const fileName = extMatch ? extMatch[1].trim() : rawName.split("\n")[0].trim();
    if (fileName && fileName.length > 2 && fileName.length < 80 && !foundFiles.some((f) => f.name === fileName)) {
      foundFiles.push({ name: fileName, url: href || "" });
    }
  }

  // 4. Extract text
  let rawText = containerNode.innerText || "";
  let cleanText = cleanMessageText(rawText);

  // Clean duplicate "Image" or filename text left behind by innerText
  for (const img of foundImages) {
    if (img.alt && img.alt !== "Picture" && img.alt !== "Image") {
      cleanText = cleanText.replace(new RegExp(`${img.alt}\\s*Image`, "gi"), "");
    }
  }
  for (const f of foundFiles) {
    cleanText = cleanText.replace(new RegExp(`${f.name}`, "gi"), "");
  }
  cleanText = cleanText.replace(/^(?:Image|Uploaded image)$/gim, "").trim();

  // 5. Combine into markdown format
  const imgMarkdown = foundImages.map((img) => `\n![${img.alt}](${img.src})\n`).join("");
  const fileMarkdown = foundFiles.map((f) => f.url ? `\n[📁 ${f.name}](${f.url})\n` : `\n[📁 Attached File: ${f.name}]\n`).join("");
  const attachmentsMd = (imgMarkdown + fileMarkdown).trim();

  if (attachmentsMd && cleanText) {
    return `${cleanText}\n\n${attachmentsMd}`.trim();
  } else if (attachmentsMd) {
    return attachmentsMd.trim();
  }
  return cleanText;
}

// Each adapter knows how to read one site.
const ADAPTERS = {
  "chatgpt.com": {
    source: "chatgpt",
    readMessages() {
      // 1. Modern OpenAI search units (data-chatgpt-search-unit-key) - Standard in 2024-2026
      const rawUnits = [
        ...document.querySelectorAll(
          '[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":assistant"]'
        ),
      ];
      const searchUnits = rawUnits.filter((el, idx) => {
        return !rawUnits.some((other, oIdx) => oIdx !== idx && other.contains(el));
      });
      if (searchUnits.length > 0) {
        const msgs = [];
        for (const el of searchUnits) {
          const key = el.getAttribute("data-chatgpt-search-unit-key") || "";
          const role = key.endsWith(":user") ? "user" : "assistant";
          const targetNode = role === "assistant" ? (el.querySelector(".markdown, .prose") || el) : el;
          const content = extractMessageContent(targetNode);
          if (content && !isIgnoredUI(content)) {
            if (msgs.length === 0 || msgs[msgs.length - 1].content !== content) {
              msgs.push({ role, content });
            }
          }
        }
        if (msgs.length > 0) return msgs;
      }

      // 2. Modern OpenAI turn keys (data-turn-key)
      const turnKeyNodes = [...document.querySelectorAll("[data-turn-key]")];
      if (turnKeyNodes.length > 0) {
        const msgs = [];
        for (const turn of turnKeyNodes) {
          const u = turn.querySelector(
            '[data-chatgpt-search-unit-key$=":user"], [class*="user"], .whitespace-pre-wrap'
          );
          const a = turn.querySelector(
            '[data-chatgpt-search-unit-key$=":assistant"], .markdown, .prose'
          );
          if (u) {
            const uText = extractMessageContent(u);
            if (uText && !isIgnoredUI(uText)) msgs.push({ role: "user", content: uText });
          }
          if (a) {
            const aText = extractMessageContent(a);
            if (aText && !isIgnoredUI(aText)) msgs.push({ role: "assistant", content: aText });
          }
        }
        if (msgs.length > 0) return msgs;
      }

      // 3. Direct message containers with data-message-author-role
      const rawRoleNodes = [...document.querySelectorAll("[data-message-author-role]")];
      const roleNodes = rawRoleNodes.filter((el, idx) => {
        return !rawRoleNodes.some((other, oIdx) => oIdx !== idx && other.contains(el));
      });
      if (roleNodes.length > 0) {
        const msgs = [];
        for (const el of roleNodes) {
          const role = el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant";
          const targetNode = role === "assistant" ? (el.querySelector(".markdown, .prose") || el) : el;
          const content = extractMessageContent(targetNode);
          if (content && !isIgnoredUI(content)) {
            if (msgs.length === 0 || msgs[msgs.length - 1].content !== content) {
              msgs.push({ role, content });
            }
          }
        }
        if (msgs.length > 0) return msgs;
      }

      // 4. [data-message-id] elements
      const idNodes = [...document.querySelectorAll("div[data-message-id], [data-message-id]")];
      if (idNodes.length > 0) {
        const msgs = [];
        for (let i = 0; i < idNodes.length; i++) {
          const el = idNodes[i];
          const roleAttr = el.getAttribute("data-message-author-role");
          const hasMd = el.querySelector(".markdown, .prose") !== null;
          const isUserClass =
            (el.className || "").toString().includes("user") ||
            el.querySelector("[data-testid*='user']") !== null;

          let role = "assistant";
          if (roleAttr === "user" || isUserClass) {
            role = "user";
          } else if (roleAttr === "assistant" || hasMd) {
            role = "assistant";
          } else {
            role = i % 2 === 0 ? "user" : "assistant";
          }

          const targetNode = role === "assistant" ? (el.querySelector(".markdown, .prose") || el) : el;
          const content = extractMessageContent(targetNode);
          if (content && !isIgnoredUI(content)) {
            msgs.push({ role, content });
          }
        }
        if (msgs.length > 0) return msgs;
      }

      // 5. Article or conversation turn containers
      const turnNodes = [...document.querySelectorAll("article, [data-testid^='conversation-turn-']")];
      if (turnNodes.length > 0) {
        const msgs = [];
        for (let i = 0; i < turnNodes.length; i++) {
          const turn = turnNodes[i];
          const userEl = turn.querySelector(
            "[data-message-author-role='user'], [data-testid*='user'], .whitespace-pre-wrap"
          );
          const assistantEl = turn.querySelector(
            "[data-message-author-role='assistant'], [data-testid*='assistant'], .markdown, .prose"
          );

          if (userEl) {
            const uText = extractMessageContent(userEl);
            if (uText && !isIgnoredUI(uText)) msgs.push({ role: "user", content: uText });
          }
          if (assistantEl) {
            const aText = extractMessageContent(assistantEl);
            if (aText && !isIgnoredUI(aText)) msgs.push({ role: "assistant", content: aText });
          }
          if (!userEl && !assistantEl) {
            const text = extractMessageContent(turn);
            if (text && !isIgnoredUI(text)) {
              msgs.push({ role: i % 2 === 0 ? "user" : "assistant", content: text });
            }
          }
        }
        if (msgs.length > 0) return msgs;
      }

      // 6. Invariant fallback: Locate all .markdown blocks and their preceding prompt turn
      const mdNodes = [...document.querySelectorAll(".markdown")];
      if (mdNodes.length > 0) {
        const msgs = [];
        for (let i = 0; i < mdNodes.length; i++) {
          const md = mdNodes[i];
          const turnParent =
            md.closest("[data-turn-key], [data-testid^='conversation-turn-'], article, div.group") ||
            md.parentElement?.parentElement;
          const prevTurn = turnParent?.previousElementSibling;
          if (prevTurn) {
            const userText = extractMessageContent(prevTurn);
            if (userText && !isIgnoredUI(userText)) {
              msgs.push({ role: "user", content: userText });
            }
          }
          const assistantText = extractMessageContent(md);
          if (assistantText && !isIgnoredUI(assistantText)) {
            msgs.push({ role: "assistant", content: assistantText });
          }
        }
        if (msgs.length > 0) return msgs;
      }

      return [];
    },
    externalId() {
      const cMatch = location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
      if (cMatch) return cMatch[1];
      const otherMatch = location.pathname.match(/\/(?:share|g)\/([a-zA-Z0-9_-]+)/);
      if (otherMatch) return otherMatch[1];
      return null;
    },
    title() {
      const currentId = location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1];
      if (currentId) {
        const sidebarLink = document.querySelector(`nav a[href*="${currentId}"]`);
        if (sidebarLink) {
          const sideText = sidebarLink.innerText.trim().split("\n")[0];
          if (sideText && sideText.toLowerCase() !== "new chat" && sideText.toLowerCase() !== "chatgpt") {
            return sideText;
          }
        }
      }

      let clean = document.title
        .replace(/^ChatGPT\s*[-|•\\]\s*/i, "")
        .replace(/\s*[-|•\\]\s*ChatGPT.*$/i, "")
        .trim();
      if (clean && clean.toLowerCase() !== "chatgpt" && clean.toLowerCase() !== "new chat") {
        return clean;
      }

      const header = document.querySelector("header h1, nav a[aria-current='page']")?.textContent?.trim();
      if (header && !header.toLowerCase().includes("chatgpt") && header.toLowerCase() !== "new chat") {
        return header;
      }

      return clean && clean.toLowerCase() !== "new chat" ? clean : "ChatGPT Conversation";
    },
    inputBox() {
      return (
        document.querySelector("#prompt-textarea") ||
        document.querySelector("div[id='prompt-textarea']") ||
        document.querySelector("div[id='prompt-textarea'] p") ||
        document.querySelector("div[role='textbox']") ||
        document.querySelector("div.ProseMirror") ||
        document.querySelector("div[class*='ProseMirror']") ||
        document.querySelector("div[data-placeholder*='Ask']") ||
        document.querySelector("div[data-placeholder*='Message']") ||
        document.querySelector("div[contenteditable='true']") ||
        document.querySelector("form textarea") ||
        document.querySelector("textarea[placeholder*='Message']") ||
        document.querySelector("textarea[placeholder*='Ask']") ||
        document.querySelector("textarea")
      );
    },
  },
  "claude.ai": {
    source: "claude",
    readMessages() {
      const selectors = [
        "[data-testid='user-message']",
        "[data-testid='assistant-message']",
        ".font-user-message",
        ".font-claude-message",
        "[class*='font-user-message']",
        "[class*='font-claude-message']",
        "div[class*='HumanMessage']",
        "div[class*='ClaudeMessage']",
        "div[class*='AssistantMessage']",
        "div[class*='user-message']",
        "div[class*='claude-message']",
        "[data-message-author-role]",
      ];
      const rawNodes = [...document.querySelectorAll(selectors.join(", "))];
      // Keep only top-level nodes (exclude children that are nested inside another matched element)
      const nodes = rawNodes.filter((el, idx) => {
        return !rawNodes.some((other, oIdx) => oIdx !== idx && other.contains(el));
      });
      if (nodes.length) {
        const msgs = [];
        for (const el of nodes) {
          const testId = (el.getAttribute("data-testid") || "").toLowerCase();
          const roleAttr = (el.getAttribute("data-message-author-role") || "").toLowerCase();
          const cls = (el.className || "").toString().toLowerCase();
          const isUser =
            testId.includes("user") ||
            roleAttr === "user" ||
            cls.includes("user") ||
            cls.includes("human");
          const content = extractMessageContent(el);
          if (content && !isIgnoredUI(content)) {
            if (msgs.length === 0 || msgs[msgs.length - 1].content !== content) {
              msgs.push({
                role: isUser ? "user" : "assistant",
                content,
              });
            }
          }
        }
        if (msgs.length > 0) return msgs;
      }

      const turnContainers = [
        ...document.querySelectorAll("div.group, [class*='ConversationTurn'], [data-is-streaming]"),
      ];
      if (turnContainers.length) {
        const msgs = [];
        for (let i = 0; i < turnContainers.length; i++) {
          const el = turnContainers[i];
          const content = extractMessageContent(el);
          if (!content || isIgnoredUI(content)) continue;
          const isUser =
            el.querySelector(".font-user-message, [class*='user'], [data-testid*='user']") !== null;
          msgs.push({
            role: isUser ? "user" : (i % 2 === 0 ? "user" : "assistant"),
            content,
          });
        }
        if (msgs.length) return msgs;
      }

      return [];
    },
    externalId() {
      const m = location.pathname.match(/\/(?:chat|project\/[^/]+\/chat)\/([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
      const q = new URLSearchParams(location.search).get("chat");
      return q || null;
    },
    title() {
      const headerTitle = document.querySelector(
        "header [data-testid='chat-title'], header h1, header button"
      )?.textContent?.trim();
      if (headerTitle && !headerTitle.toLowerCase().includes("claude") && headerTitle.toLowerCase() !== "new chat") {
        return headerTitle;
      }
      const clean = document.title
        .replace(/\s*[-|•\\]\s*Claude.*$/i, "")
        .replace(/^Claude\s*[-|•\\]\s*/i, "")
        .trim();
      return clean && clean.toLowerCase() !== "new chat" ? clean : "Claude Conversation";
    },
    inputBox() {
      return (
        document.querySelector(".ProseMirror[contenteditable='true']") ||
        document.querySelector("div.ProseMirror") ||
        document.querySelector("[contenteditable='true']") ||
        document.querySelector("div[enterkeyhint='enter']") ||
        document.querySelector("fieldset div[contenteditable='true']") ||
        document.querySelector("textarea")
      );
    },
  },
  "gemini.google.com": {
    source: "gemini",
    readMessages() {
      const user = [
        ...document.querySelectorAll(
          "user-query, .user-query, [data-test-id='user-query'], div[class*='user-query'], .query-content"
        ),
      ];
      const model = [
        ...document.querySelectorAll(
          "model-response, .model-response-text, [data-test-id='model-response'], div[class*='model-response'], .response-content, message-content"
        ),
      ];
      const out = [];
      const n = Math.max(user.length, model.length);
      for (let i = 0; i < n; i++) {
        if (user[i]) {
          const uText = extractMessageContent(user[i]);
          if (uText && !isIgnoredUI(uText)) out.push({ role: "user", content: uText });
        }
        if (model[i]) {
          const mText = extractMessageContent(model[i]);
          if (mText && !isIgnoredUI(mText)) out.push({ role: "assistant", content: mText });
        }
      }
      if (out.length > 0) return out;

      const turns = [
        ...document.querySelectorAll("chat-turn, [class*='chat-turn'], conversation-container > div"),
      ];
      if (turns.length > 0) {
        for (let i = 0; i < turns.length; i++) {
          const content = extractMessageContent(turns[i]);
          if (!content || isIgnoredUI(content)) continue;
          const isUser = turns[i].querySelector("user-query, [class*='user']") !== null;
          out.push({
            role: isUser ? "user" : (i % 2 === 0 ? "user" : "assistant"),
            content,
          });
        }
        if (out.length > 0) return out;
      }

      return [];
    },
    externalId() {
      const m = location.pathname.match(/\/(?:app|share)\/([a-zA-Z0-9_-]+)/);
      return m ? m[1] : null;
    },
    title() {
      return document.title.replace(/\s*[-|•\\]\s*Gemini.*$/i, "").trim() || "Gemini Conversation";
    },
    inputBox() {
      return (
        document.querySelector(".ql-editor") ||
        document.querySelector("rich-textarea [contenteditable='true']") ||
        document.querySelector("rich-textarea textarea") ||
        document.querySelector("div[contenteditable='true']") ||
        document.querySelector("[contenteditable='true']") ||
        document.querySelector("textarea")
      );
    },
  },
};

const cleanHost = location.hostname.replace(/^www\./, "");
const adapter =
  ADAPTERS[cleanHost] ||
  (cleanHost.includes("chatgpt.com") || cleanHost.includes("openai.com") ? ADAPTERS["chatgpt.com"] : null) ||
  (cleanHost.includes("claude.ai") ? ADAPTERS["claude.ai"] : null) ||
  (cleanHost.includes("gemini.google.com") ? ADAPTERS["gemini.google.com"] : null);

window.chatbridgeAdapter = adapter;
window.adapter = adapter;
