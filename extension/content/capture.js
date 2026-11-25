(() => {
  const currentAdapter =
    window.chatbridgeAdapter ||
    window.adapter ||
    (typeof adapter !== "undefined" ? adapter : null);

  if (!currentAdapter) return;

  let timer = null;
  let lastFingerprint = "";
  let isSyncing = false;
  let isFullSyncing = false;
  let activeBearerToken = null;

  function cleanContentForPrompt(text) {
    if (!text) return "";
    return text.replace(/!\[([^\]]*)\]\(data:image\/[^)]+\)/gi, (match, alt) => {
      const cleanAlt = (alt || "Picture").trim();
      return `[Image Attachment: ${cleanAlt}]`;
    });
  }

  // Listen for live Bearer token intercepted from page context (world: MAIN via page_hook.js)
  window.addEventListener("message", (e) => {
    if (e.data && e.data.type === "CHATBRIDGE_CAPTURED_BEARER" && e.data.token) {
      activeBearerToken = e.data.token;
      try {
        chrome.storage.local.set({ chatgpt_bearer_token: e.data.token });
      } catch {}
    }
  });

  async function getChatGPTToken() {
    if (activeBearerToken) return activeBearerToken;
    try {
      const stored = await chrome.storage.local.get("chatgpt_bearer_token");
      if (stored && stored.chatgpt_bearer_token) {
        activeBearerToken = stored.chatgpt_bearer_token;
        return activeBearerToken;
      }
    } catch {}

    // Fallback: Query session endpoint
    try {
      const sessRes = await fetch("/api/auth/session");
      if (sessRes.ok) {
        const sess = await sessRes.json();
        if (sess && sess.accessToken) {
          activeBearerToken = "Bearer " + sess.accessToken;
          return activeBearerToken;
        }
      }
    } catch {}

    return null;
  }

  function buildSafeHandoffPrompt(rawMsgs, src, tgt, nextMsg = "") {
    const cleanList = (rawMsgs || [])
      .map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: (typeof cleanMessageText === "function" ? cleanMessageText(m.content) : m.content || "").trim(),
      }))
      .filter((m) => m.content.length > 0);

    const maxRecent = 10;
    const kept = cleanList.slice(-maxRecent);
    const earlierCount = cleanList.length - kept.length;

    const srcName = (src || "AI").toUpperCase();
    const tgtName = (tgt || "AI").toUpperCase();
    const intro =
      srcName === tgtName
        ? `This is a continuation of our earlier ${srcName} conversation in a fresh session.`
        : `I was previously chatting on ${srcName} and am continuing our conversation here on ${tgtName}.`;

    const lines = [
      "=== PREVIOUS CONVERSATION CONTEXT (READ-ONLY) ===",
      intro,
      "Please read our earlier discussion below and continue directly from where we left off.",
      "",
    ];

    if (earlierCount > 0) {
      lines.push(
        `[Note: ${earlierCount} earlier turns recorded in ChatBridge; showing most recent ${kept.length} turns below]`
      );
      lines.push("");
    }

    lines.push("--- CONVERSATION TRANSCRIPT ---");
    for (const m of kept) {
      const role = m.role === "user" ? "User" : "Assistant";
      let c = cleanContentForPrompt(m.content);
      if (c.length > 800) c = c.slice(0, 800) + "... [truncated for brevity]";
      lines.push(`${role}: ${c}`);
      lines.push("");
    }

    lines.push("--- NEXT USER INSTRUCTION ---");
    lines.push(
      nextMsg && nextMsg.trim() ? nextMsg.trim() : "Please continue our conversation from where we left off."
    );

    return { prompt: lines.join("\n"), messages: cleanList };
  }

  function ensureBadge() {
    let badge = document.getElementById("chatbridge-sync-badge");
    if (!badge && document.body) {
      badge = document.createElement("div");
      badge.id = "chatbridge-sync-badge";
      badge.style.cssText =
        "position: fixed; bottom: 20px; right: 20px; z-index: 9999999; padding: 8px 14px; border-radius: 20px; background: #1c1917; color: #fdfbf7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,0.35); display: flex; align-items: center; gap: 8px; border: 1px solid rgba(255,255,255,0.15); transition: all 0.3s ease; user-select: none;";

      const content = document.createElement("span");
      content.id = "chatbridge-badge-text";
      content.innerHTML = "🟢 ChatBridge: Ready";
      badge.appendChild(content);

      // 1. Sync current chat button
      const syncBtn = document.createElement("button");
      syncBtn.id = "chatbridge-badge-sync-btn";
      syncBtn.textContent = "Sync this chat";
      syncBtn.title = "Save the currently open conversation to ChatBridge";
      syncBtn.style.cssText =
        "background: #2f5d50; color: #fff; border: none; border-radius: 12px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-weight: 600; margin-left: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.2);";
      syncBtn.onclick = (e) => {
        e.stopPropagation();
        lastFingerprint = "";
        updateBadge("⏳ Scanning conversation...", "#1c1917", false);
        setTimeout(() => capture(true), 150);
      };
      badge.appendChild(syncBtn);

      // 2. Sync all conversations button
      const syncAllBtn = document.createElement("button");
      syncAllBtn.id = "chatbridge-badge-sync-all-btn";
      syncAllBtn.textContent = "⚡ Sync ALL History";
      syncAllBtn.title = "Import all your conversations from this AI into ChatBridge without having to open them";
      syncAllBtn.style.cssText =
        "background: #0284c7; color: #fff; border: none; border-radius: 12px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-weight: 600; margin-left: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.2);";
      syncAllBtn.onclick = (e) => {
        e.stopPropagation();
        if (isFullSyncing) return;
        isFullSyncing = true;
        updateBadge("⏳ Finding all conversations...", "#0369a1", false);
        deepCollectAllHistory((status) => {
          updateBadge(`⏳ ${status}`, "#0369a1", false);
        }).then((count) => {
          isFullSyncing = false;
          updateBadge(`✓ Synced all ${count} conversations to ChatBridge!`, "#14532d", true);
        });
      };
      badge.appendChild(syncAllBtn);

      // 3. Quick Cross-Platform Jump Buttons to all 3 AIs (including same platform fresh chat!)
      const currentSrc = (currentAdapter.source || "").toLowerCase();
      const allPlatforms = [
        { id: "chatgpt", label: "ChatGPT", color: "#10a37f" },
        { id: "claude", label: "Claude", color: "#d97706" },
        { id: "gemini", label: "Gemini", color: "#2563eb" },
      ];

      for (const t of allPlatforms) {
        const isCurrent = t.id === currentSrc;
        const jumpBtn = document.createElement("button");
        jumpBtn.textContent = isCurrent ? `Continue on New ${t.label} ↗` : `Continue on ${t.label} ↗`;
        jumpBtn.title = isCurrent
          ? `Transfer this conversation's locked history into a fresh new ${t.label} chat`
          : `Sync this conversation and jump straight to ${t.label}`;
        jumpBtn.style.cssText = `background: ${t.color}; color: #fff; border: none; border-radius: 12px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-weight: 600; margin-left: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.2);`;
        jumpBtn.onclick = (e) => {
          e.stopPropagation();
          updateBadge(`⏳ Preparing ${t.label}...`, t.color, false);
          capture(true, () => {
            const rawMsgs = currentAdapter.readMessages();
            const { prompt, messages: cleanMsgs } = buildSafeHandoffPrompt(
              rawMsgs,
              currentSrc,
              t.id,
              "Please continue our conversation from where we left off."
            );

            try {
              navigator.clipboard.writeText(prompt);
            } catch {}

            chrome.runtime.sendMessage(
              {
                type: "SET_PENDING_PROMPT",
                prompt,
                target: t.id,
                title: currentAdapter.title(),
                messages: cleanMsgs,
                nextMessage: "Please continue our conversation from where we left off.",
              },
              () => {
                chrome.runtime.sendMessage({
                  type: "OPEN_PLATFORM_NEW_CHAT",
                  platform: t.id,
                });
              }
            );
          });
        };
        badge.appendChild(jumpBtn);
      }

      document.body.appendChild(badge);
    }
    return badge;
  }

  function updateBadge(html, bg = "#1c1917", showSync = true) {
    ensureBadge();
    const txt = document.getElementById("chatbridge-badge-text");
    const btn = document.getElementById("chatbridge-badge-sync-btn");
    const btnAll = document.getElementById("chatbridge-badge-sync-all-btn");
    const badge = document.getElementById("chatbridge-sync-badge");
    if (txt) txt.innerHTML = html;
    if (btn) btn.style.display = showSync ? "inline-block" : "none";
    if (btnAll) btnAll.style.display = showSync ? "inline-block" : "none";
    if (badge) badge.style.background = bg;
  }

  function fingerprint(msgs) {
    return msgs.length + ":" + msgs.reduce((n, m) => n + m.content.length, 0);
  }

  async function getSyncedFingerprint(convoKey) {
    try {
      const data = await chrome.storage.local.get("chatbridge_synced_convos");
      const map = data.chatbridge_synced_convos || {};
      return map[convoKey] || null;
    } catch {
      return null;
    }
  }

  async function saveSyncedFingerprint(convoKey, fp) {
    try {
      const data = await chrome.storage.local.get("chatbridge_synced_convos");
      const map = data.chatbridge_synced_convos || {};
      map[convoKey] = fp;
      await chrome.storage.local.set({ chatbridge_synced_convos: map });
    } catch {}
  }

  async function capture(isManual = false, onDone = null) {
    const externalId = currentAdapter.externalId();
    if (!externalId) {
      updateBadge(
        "🟢 ChatBridge ready &bull; Open any chat to view or sync",
        "#1c1917",
        true
      );
      if (onDone) onDone({ ok: false, error: "No active conversation URL detected" });
      return;
    }

    const messages = currentAdapter.readMessages();
    if (!messages || messages.length === 0) {
      if (isManual) {
        updateBadge(
          "⏳ Loading messages... (scroll chat into view)",
          "#1c1917",
          true
        );
      }
      if (onDone) onDone({ ok: false, error: "Waiting for messages to load in DOM" });
      return;
    }

    const fp = fingerprint(messages);
    const convoKey = (currentAdapter.source || "ai") + ":" + externalId;

    if (!isManual) {
      if (fp === lastFingerprint) {
        if (onDone) onDone({ ok: true, skipped: true, messages: messages.length });
        return;
      }

      // Check persistent storage: if this conversation was already synced with identical messages, DO NOT re-sync!
      const storedFp = await getSyncedFingerprint(convoKey);
      if (storedFp === fp) {
        lastFingerprint = fp;
        updateBadge("🟢 ChatBridge: Ready", "#1c1917", true);
        if (onDone) onDone({ ok: true, skipped: true, alreadySynced: true, messages: messages.length });
        return;
      }
    }
    lastFingerprint = fp;

    const payload = {
      source: currentAdapter.source,
      external_id: externalId,
      title: currentAdapter.title(),
      messages,
      updated_at: new Date().toISOString(),
    };

    updateBadge(`⏳ Syncing "${payload.title.slice(0, 20)}..."`, "#2f5d50", false);
    isSyncing = true;

    chrome.runtime.sendMessage({ type: "SYNC", payload }, (res) => {
      isSyncing = false;
      if (chrome.runtime.lastError) {
        console.warn("ChatBridge extension error:", chrome.runtime.lastError.message);
        updateBadge("⚠️ Extension notice: " + chrome.runtime.lastError.message, "#7f1d1d", true);
        if (onDone) onDone({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (res && res.ok) {
        saveSyncedFingerprint(convoKey, fp);
        updateBadge(
          `✓ Synced "${payload.title.slice(0, 22)}" (${messages.length} msgs)`,
          "#14532d",
          true
        );
        if (onDone) onDone({ ok: true, title: payload.title, messages: messages.length });
      } else if (res && res.error) {
        if (res.error.includes("Not logged in")) {
          updateBadge(
            "⚠️ ChatBridge: Log in at <a href='http://localhost:5173' target='_blank' style='color:#7dd3fc;text-decoration:underline;'>localhost:5173</a> to sync",
            "#7f1d1d",
            false
          );
        } else {
          updateBadge(`⚠️ Sync notice: ${res.error}`, "#7f1d1d", true);
        }
        if (onDone) onDone({ ok: false, error: res.error });
      }
    });
  }

  // Multi-step scan series to catch previous chats as they load asynchronously
  function triggerScanSeries(isManual = false) {
    setTimeout(() => {
      if (!isSyncing && !isFullSyncing) capture(isManual);
    }, 1800);
  }

  // Helper to extract clean text from ChatGPT node message
  function extractNodeMessageText(m) {
    if (!m || !m.content) return "";
    const c = m.content;
    if (Array.isArray(c.parts)) {
      const textParts = [];
      for (const p of c.parts) {
        if (typeof p === "string") {
          textParts.push(p);
        } else if (p && typeof p === "object") {
          if (p.content_type === "image_asset_pointer" || p.asset_pointer) {
            textParts.push("[Image Attachment]");
          } else if (p.text) {
            textParts.push(p.text);
          }
        }
      }
      return textParts.join("\n").trim();
    }
    if (typeof c.text === "string") return c.text.trim();
    return "";
  }

  // Helper to traverse ChatGPT's mapping tree in exact chronological order
  function extractMessagesFromMapping(mapping, currentNodeId) {
    const messages = [];
    if (!mapping) return messages;

    // 1. Determine active leaf node
    let targetNodeId = currentNodeId;
    if (!targetNodeId || !mapping[targetNodeId]) {
      const leaves = Object.values(mapping).filter(
        (n) => (!n.children || n.children.length === 0) && n.message
      );
      if (leaves.length > 0) {
        leaves.sort((a, b) => (b.message?.create_time || 0) - (a.message?.create_time || 0));
        targetNodeId = leaves[0].id;
      }
    }

    // 2. Follow active path backwards from leaf to root
    if (targetNodeId && mapping[targetNodeId]) {
      const path = [];
      let curr = mapping[targetNodeId];
      const visited = new Set();
      while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        if (curr.message) {
          path.push(curr.message);
        }
        curr = curr.parent ? mapping[curr.parent] : null;
      }
      path.reverse();
      for (const m of path) {
        const role =
          m.author?.role === "user"
            ? "user"
            : m.author?.role === "assistant"
            ? "assistant"
            : null;
        if (!role) continue;
        const text = extractNodeMessageText(m);
        if (text && !isIgnoredUI(text)) {
          const clean = cleanMessageText(text);
          if (messages.length === 0 || messages[messages.length - 1].content !== clean) {
            messages.push({ role, content: clean });
          }
        }
      }
      if (messages.length > 0) return messages;
    }

    // 3. Fallback: traverse from ROOT down following primary child pointer
    const rootNode = Object.values(mapping).find((n) => !n.parent);
    if (rootNode) {
      const visited = new Set();
      let curr = rootNode;
      while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        if (curr.message) {
          const role =
            curr.message.author?.role === "user"
              ? "user"
              : curr.message.author?.role === "assistant"
              ? "assistant"
              : null;
          if (role) {
            const text = extractNodeMessageText(curr.message);
            if (text && !isIgnoredUI(text)) {
              const clean = cleanMessageText(text);
              if (messages.length === 0 || messages[messages.length - 1].content !== clean) {
                messages.push({ role, content: clean });
              }
            }
          }
        }
        if (curr.children && curr.children.length > 0) {
          curr = mapping[curr.children[curr.children.length - 1]];
        } else {
          break;
        }
      }
      if (messages.length > 0) return messages;
    }

    return messages;
  }

  // Deep Auto-Collector: Paginates through ALL conversations in this AI and syncs them
  async function deepCollectAllHistory(onProgress = null) {
    let collectedCount = 0;

    // 1. ChatGPT Full Sync
    if (location.hostname.includes("chatgpt.com") || location.hostname.includes("openai.com")) {
      try {
        const token = await getChatGPTToken();
        const headers = token ? { Authorization: token } : {};

        let offset = 0;
        const limit = 28;
        const allItems = [];
        let totalExpected = null;

        while (true) {
          if (onProgress) onProgress(`Finding all conversations... (${allItems.length} found)`);
          let listRes = null;
          try {
            listRes = await fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}`, {
              headers,
              credentials: "include",
            });
          } catch {}

          if (!listRes || !listRes.ok) break;
          const listData = await listRes.json();
          const items = listData.items || [];
          if (items.length === 0) break;

          allItems.push(...items);
          if (typeof listData.total === "number") totalExpected = listData.total;
          offset += items.length;

          if (totalExpected && offset >= totalExpected) break;
          if (items.length < limit) break;
          if (allItems.length >= 250) break; // safety ceiling
          await new Promise((r) => setTimeout(r, 120));
        }

        // Also check sidebar links in DOM to ensure no conversations were missed
        const sidebarLinks = [...document.querySelectorAll("nav a[href*='/c/'], ol a[href*='/c/']")];
        for (const link of sidebarLinks) {
          const href = link.getAttribute("href") || "";
          const match = href.match(/\/c\/([a-zA-Z0-9_-]+)/);
          if (match && !allItems.some((item) => item.id === match[1])) {
            allItems.push({
              id: match[1],
              title: link.innerText.trim().split("\n")[0] || "ChatGPT Conversation",
            });
          }
        }

        if (onProgress) onProgress(`Found ${allItems.length} conversations. Syncing...`);

        for (let i = 0; i < allItems.length; i++) {
          const item = allItems[i];
          if (onProgress) {
            onProgress(`Syncing conversation ${i + 1} of ${allItems.length}: "${item.title.slice(0, 22)}..."`);
          }

          try {
            const detailRes = await fetch(`/backend-api/conversation/${item.id}`, {
              headers,
              credentials: "include",
            });
            if (detailRes.ok) {
              const detail = await detailRes.json();
              const msgs = extractMessagesFromMapping(detail.mapping, detail.current_node);
              if (msgs.length > 0) {
                const updateTime = detail.update_time || item.update_time;
                const createTime = detail.create_time || item.create_time;
                const updatedAt = updateTime
                  ? new Date(updateTime * 1000).toISOString()
                  : (createTime
                      ? new Date(createTime * 1000).toISOString()
                      : new Date(Date.now() - i * 60000).toISOString());
                const createdAt = createTime ? new Date(createTime * 1000).toISOString() : updatedAt;

                await new Promise((resolve) => {
                  chrome.runtime.sendMessage(
                    {
                      type: "SYNC",
                      payload: {
                        source: "chatgpt",
                        external_id: item.id,
                        title: detail.title || item.title || "ChatGPT Conversation",
                        messages: msgs,
                        created_at: createdAt,
                        updated_at: updatedAt,
                      },
                    },
                    () => resolve()
                  );
                });
                collectedCount++;
              }
            }
          } catch (err) {
            console.warn(`[ChatBridge] Detail sync error for ${item.id}:`, err);
          }

          // 220ms pacing to strictly avoid 429 rate limit
          await new Promise((r) => setTimeout(r, 220));
        }
      } catch (e) {
        console.warn("[ChatBridge] Full ChatGPT history sync error:", e);
      }
    }

    // 2. Claude Full Sync
    if (location.hostname.includes("claude.ai")) {
      try {
        const orgsRes = await fetch("/api/organizations", { credentials: "include" });
        if (orgsRes.ok) {
          const orgs = await orgsRes.json();
          const orgId = orgs[0]?.uuid;
          if (orgId) {
            const listRes = await fetch(`/api/organizations/${orgId}/chat_conversations`, {
              credentials: "include",
            });
            if (listRes.ok) {
              const items = await listRes.json();
              if (Array.isArray(items)) {
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  if (onProgress) {
                    onProgress(`Syncing Claude conversation ${i + 1} of ${items.length}: "${(item.name || "").slice(0, 22)}..."`);
                  }

                  try {
                    const detailRes = await fetch(
                      `/api/organizations/${orgId}/chat_conversations/${item.uuid}`,
                      { credentials: "include" }
                    );
                    if (detailRes.ok) {
                      const detail = await detailRes.json();
                      const sortedChatMessages = [...(detail.chat_messages || [])].sort((a, b) => {
                        if (typeof a.index === "number" && typeof b.index === "number") {
                          return a.index - b.index;
                        }
                        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
                      });

                      const msgs = [];
                      for (const m of sortedChatMessages) {
                        const role = m.sender === "human" ? "user" : "assistant";
                        const content = m.text || "";
                        if (content.trim()) {
                          if (msgs.length === 0 || msgs[msgs.length - 1].content !== content.trim()) {
                            msgs.push({ role, content: content.trim() });
                          }
                        }
                      }

                      const updatedAt = detail.updated_at || item.updated_at || detail.created_at || item.created_at || new Date(Date.now() - i * 60000).toISOString();
                      const createdAt = detail.created_at || item.created_at || updatedAt;

                      if (msgs.length > 0) {
                        await new Promise((resolve) => {
                          chrome.runtime.sendMessage(
                            {
                              type: "SYNC",
                              payload: {
                                source: "claude",
                                external_id: item.uuid,
                                title: detail.name || item.name || "Claude Conversation",
                                messages: msgs,
                                created_at: createdAt,
                                updated_at: updatedAt,
                              },
                            },
                            () => resolve()
                          );
                        });
                        collectedCount++;
                      }
                    }
                  } catch {}
                  await new Promise((r) => setTimeout(r, 220));
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn("[ChatBridge] Claude sync error:", e);
      }
    }

    return collectedCount;
  }

  // 4. Rate Limit & Usage Cap Detector with Smart Relay
  function checkForRateLimits() {
    const alertNodes = [
      ...document.querySelectorAll(
        "[role='alert'], [data-testid*='error'], div[class*='banner'][class*='error'], div[class*='alert'][class*='error'], .text-red-500"
      ),
    ];
    let alertText = "";
    for (const node of alertNodes) {
      alertText += " " + (node.textContent || "");
    }
    if (!alertText.trim()) return;

    const isLimitHit =
      /out of free messages/i.test(alertText) ||
      /reached your free message limit/i.test(alertText) ||
      /reached your usage limit/i.test(alertText) ||
      /usage limit reached/i.test(alertText) ||
      /too many requests/i.test(alertText) ||
      /conversation is relatively long.*start a new conversation/i.test(alertText) ||
      /limit until \d+:\d+/i.test(alertText);

    if (!isLimitHit) return;

    let relayBanner = document.getElementById("chatbridge-limit-relay-banner");
    if (relayBanner) return;

    const currentSrc = (currentAdapter.source || "ai").toLowerCase();
    const otherPlatforms = [
      { id: "chatgpt", label: "ChatGPT", color: "#10a37f" },
      { id: "claude", label: "Claude", color: "#d97706" },
      { id: "gemini", label: "Gemini", color: "#2563eb" },
    ].filter((p) => p.id !== currentSrc);

    relayBanner = document.createElement("div");
    relayBanner.id = "chatbridge-limit-relay-banner";
    relayBanner.style.cssText =
      "position: fixed; bottom: 80px; right: 20px; z-index: 99999999; max-width: 440px; background: #0f172a; border: 2px solid #f59e0b; border-radius: 14px; padding: 14px 18px; box-shadow: 0 12px 36px rgba(0,0,0,0.85); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f8fafc;";

    relayBanner.innerHTML = `
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 22px;">⚡</span>
          <div>
            <b style="font-size: 13px; color: #fbbf24;">Rate Limit Detected on ${currentSrc.toUpperCase()}!</b>
            <div style="font-size: 11.5px; color: #94a3b8; margin-top: 2px;">
              Don't wait! Continue this conversation instantly with ChatBridge AI Relay:
            </div>
          </div>
        </div>
        <button id="cb-relay-close" style="background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px;">✕</button>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 10px;">
        ${otherPlatforms
          .map(
            (p) => `
          <button
            type="button"
            class="cb-relay-btn"
            data-target="${p.id}"
            style="flex: 1; background: ${p.color}; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"
          >
            Continue on ${p.label} →
          </button>
        `
          )
          .join("")}
      </div>
    `;

    document.body.appendChild(relayBanner);
    document.getElementById("cb-relay-close")?.addEventListener("click", () => relayBanner.remove());

    relayBanner.querySelectorAll(".cb-relay-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        relayBanner.remove();
        updateBadge(`⏳ Transferring to ${targetId.toUpperCase()}...`, "#2563eb", false);

        capture(true, () => {
          const rawMsgs = currentAdapter.readMessages();
          const { prompt, messages: cleanMsgs } = buildSafeHandoffPrompt(
            rawMsgs,
            currentSrc,
            targetId,
            "Please continue our conversation from where we left off."
          );

          try {
            navigator.clipboard.writeText(prompt);
          } catch {}

          chrome.runtime.sendMessage(
            {
              type: "SET_PENDING_PROMPT",
              prompt,
              target: targetId,
              title: currentAdapter.title(),
              messages: cleanMsgs,
              nextMessage: "Please continue our conversation from where we left off.",
            },
            () => {
              chrome.runtime.sendMessage({
                type: "OPEN_PLATFORM_NEW_CHAT",
                platform: targetId,
              });
            }
          );
        });
      });
    });
  }

  // Initial runs
  const init = () => {
    ensureBadge();
    triggerScanSeries(false);
    checkForRateLimits();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // MutationObserver for streaming responses and dynamically loaded past messages
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      capture(false);
      checkForRateLimits();
    }, 2500);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  }

  // Periodic check for rate limits (every 6 seconds)
  setInterval(checkForRateLimits, 6000);

  // Periodic check for rate limits (every 2 seconds)
  setInterval(checkForRateLimits, 2000);

  // Detect route changes when switching between previous chats in the sidebar
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastFingerprint = "";
      updateBadge("⏳ Loading conversation...", "#1c1917", false);
      triggerScanSeries(false);
    }
  }, 400);

  // When clicking on a conversation link in the sidebar, trigger scan immediately
  document.addEventListener(
    "click",
    (e) => {
      const link = e.target.closest("a[href*='/c/'], a[href*='/chat/'], a[href*='/app/'], nav a");
      if (link) {
        lastFingerprint = "";
        triggerScanSeries(false);
      }
    },
    true
  );

  // When scrolling past conversations, debounce scan so lazy-loaded turns are captured
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => capture(false), 800);
    },
    { passive: true }
  );

  // Listen for manual trigger commands or auto-collect requests
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "TRIGGER_DEEP_SYNC" || msg.type === "SYNC_ALL_HISTORY") {
      deepCollectAllHistory((progress) => {
        updateBadge(`⏳ ${progress}`, "#0369a1", false);
      }).then((count) => {
        if (count > 0) {
          updateBadge(`✓ Synced all ${count} conversations to ChatBridge!`, "#14532d", true);
        }
        sendResponse({ ok: true, deepCollected: count });
      });
      return true;
    }

    if (
      msg.type === "TRIGGER_CAPTURE" ||
      msg.type === "SCAN_NOW" ||
      msg.type === "AUTO_COLLECT_NOW"
    ) {
      capture(true, (res) => {
        sendResponse({ ok: true, activeResult: res });
      });
      return true;
    }
  });
})();
