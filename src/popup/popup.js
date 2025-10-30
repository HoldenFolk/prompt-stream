import { UI_STRINGS } from "../config.js";
import { ModelClient } from "../ai/modelClient.js";
import { els } from "../ui/dom.js";
import { setStatus, showProgress, setProgress } from "../ui/status.js";
import { getAvailability } from "../ai/apiShim.js";
import { MSG, USER_SETTINGS_KEYS, USER_SETTINGS_DEFAULTS } from "../ai/constants.js";

const client = new ModelClient();

const STORAGE_KEYS = {
  MODEL_READY: "modelReady",
  POPUP_PAYLOAD: "popupPayload"
};

const hasChromeSessionStorage =
  typeof chrome !== "undefined" &&
  !!chrome.storage &&
  !!chrome.storage.session &&
  typeof chrome.storage.session.get === "function";

function debounce(fn, delay = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

const hasChromeSyncStorage =
  typeof chrome !== "undefined" &&
  !!chrome.storage &&
  !!chrome.storage.sync &&
  typeof chrome.storage.sync.get === "function";

const storage = (() => {
  return {
    async get(key) {
      if (hasChromeSyncStorage) {
        const value = await new Promise((resolve) => {
          chrome.storage.sync.get(key, (obj) => {
            if (chrome.runtime?.lastError) {
              resolve(undefined);
              return;
            }
            resolve(obj?.[key]);
          });
        });
        if (value !== undefined) return value;
      }
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return undefined;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      } catch (err) {
        console.warn("Local storage read failed:", err);
        return undefined;
      }
    },
    async set(key, value) {
      if (hasChromeSyncStorage) {
        await new Promise((resolve) => {
          chrome.storage.sync.set({ [key]: value }, () => {
            if (chrome.runtime?.lastError) {
              console.warn("Failed to persist setting", chrome.runtime.lastError);
            }
            resolve();
          });
        });
      } else {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
          console.warn("Local storage write failed:", err);
        }
      }
    }
  };
})();

const sessionStore = (() => {
  if (hasChromeSessionStorage) {
    return {
      async get(key) {
        const obj = await chrome.storage.session.get(key);
        return Boolean(obj[key]);
      },
      async set(key, value) {
        if (!value) {
          await chrome.storage.session.remove(key);
          return;
        }
        await chrome.storage.session.set({ [key]: true });
      },
      async remove(key) {
        await chrome.storage.session.remove(key);
      }
    };
  }

  let fallback = null;
  try {
    fallback = typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    fallback = null;
  }

  return {
    async get(key) {
      if (!fallback) return false;
      return fallback.getItem(key) === "true";
    },
    async set(key, value) {
      if (!fallback) return;
      if (value) {
        fallback.setItem(key, "true");
      } else {
        fallback.removeItem(key);
      }
    },
    async remove(key) {
      if (!fallback) return;
      fallback.removeItem(key);
    }
  };
})();

let conversation = [];
let isStreaming = false;
const pendingAutoRuns = [];
let isProcessingAutoRun = false;

function notifyModelReadyBroadcast() {
  try {
    chrome.runtime?.sendMessage?.(
      { type: MSG.MODEL_READY },
      () => {
        void chrome.runtime?.lastError;
      }
    );
  } catch (err) {
    console.warn("Model ready broadcast failed:", err);
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG.POPUP_PAYLOAD_DELIVER) {
      handleDeliveredPayload(msg.payload);
    }
  });
}

if (hasChromeSyncStorage && typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (Object.prototype.hasOwnProperty.call(changes, USER_SETTINGS_KEYS.SYSTEM_PROMPT)) {
      const change = changes[USER_SETTINGS_KEYS.SYSTEM_PROMPT];
      const newValue = typeof change?.newValue === "string"
        ? change.newValue
        : USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SYSTEM_PROMPT];
      if (document.activeElement !== els.system) {
        els.system.value = newValue;
        els.system.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });
}

function updateControls() {
  if (client.isReady) {
    els.init.disabled = true;
    els.send.disabled = isStreaming;
    els.stop.disabled = !isStreaming;
    els.reset.disabled = isStreaming;
  } else {
    els.init.disabled = false;
    els.send.disabled = true;
    els.stop.disabled = true;
    els.reset.disabled = true;
  }
}

async function persistModelReadyFlag(isReady) {
  try {
    await sessionStore.set(STORAGE_KEYS.MODEL_READY, isReady);
  } catch (err) {
    console.warn("Unable to persist model ready flag:", err);
  }
}

async function ensureModelReady({ auto = false } = {}) {
  showProgress(true);
  try {
    await client.ensureReady({
      systemText: els.system.value,
      onStatus: setStatus,
      onProgress: setProgress,
    });
    await persistModelReadyFlag(true);
    notifyModelReadyBroadcast();
    setStatus("Model ready.");
    return true;
  } catch (err) {
    if (!auto) {
      setStatus(`Init error: ${err.message}`);
    } else {
      setStatus(`Auto-init failed: ${err.message}`);
    }
    await persistModelReadyFlag(false);
    throw err;
  } finally {
    showProgress(false);
    updateControls();
  }
}

async function maybeAutoInitModel() {
  isStreaming = false;
  updateControls();

  let hasReadyFlag = false;
  try {
    hasReadyFlag = await sessionStore.get(STORAGE_KEYS.MODEL_READY);
  } catch (err) {
    console.warn("Model ready flag check failed:", err);
  }

  if (hasReadyFlag) {
    setStatus("Restoring Gemini Nano session…");
    try {
      await ensureModelReady({ auto: true });
      return;
    } catch (err) {
      console.warn("Auto-init (from flag) failed:", err);
    }
  }

  try {
    const availability = await getAvailability();

    if (availability === "available") {
      setStatus("Model downloaded — initializing…");
      await ensureModelReady({ auto: true });
      return;
    }

    if (availability === "downloading") {
      setStatus("Model download already in progress. Check back shortly.");
      els.init.disabled = true;
      els.send.disabled = true;
      els.reset.disabled = true;
      return;
    }

    if (availability === "downloadable") {
      setStatus("Click 'Init / Download model' to download Gemini Nano.");
    } else {
      setStatus("Model unavailable on this device.");
    }

    updateControls();
  } catch (err) {
    console.warn("Availability lookup failed:", err);
    setStatus(`Auto-init check failed: ${err.message}`);
    updateControls();
  }
}

async function restoreSystemPrompt() {
  const promptEl = els.system;

  try {
    const storedValue = await storage.get(USER_SETTINGS_KEYS.SYSTEM_PROMPT);
    const value = storedValue !== undefined && storedValue !== null
      ? storedValue
      : USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SYSTEM_PROMPT];
    promptEl.value = value;
    promptEl.dispatchEvent(new Event("input", { bubbles: true }));
  } catch (e) {
    console.warn("Failed to restore prompt:", e);
  }

  const saveDraft = debounce(async (value) => {
    try {
      await storage.set(USER_SETTINGS_KEYS.SYSTEM_PROMPT, value);
    } catch (e) {
      console.warn("Failed to save prompt:", e);
    }
  }, 300);

  promptEl.addEventListener("input", () => {
    saveDraft(promptEl.value);
  });

  promptEl.addEventListener("blur", () => {
    storage.set(USER_SETTINGS_KEYS.SYSTEM_PROMPT, promptEl.value).catch(() => {});
  });
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    els.chatBox.scrollTop = els.chatBox.scrollHeight;
  });
}

function createChatMessage(role, text = "") {
  const msgEl = document.createElement("div");
  msgEl.className = `chat-message ${role}`;

  const roleEl = document.createElement("div");
  roleEl.className = "chat-role";
  roleEl.textContent =
    role === "user" ? "You" :
    role === "assistant" ? "Gemini" :
    "System";

  const contentEl = document.createElement("div");
  contentEl.className = "chat-content";
  contentEl.textContent = text;

  msgEl.append(roleEl, contentEl);
  els.chatLog.appendChild(msgEl);
  scrollChatToBottom();
  return contentEl;
}

function resetConversationUI() {
  conversation = [];
  els.chatLog.innerHTML = "";
  scrollChatToBottom();
  pendingAutoRuns.length = 0;
  isProcessingAutoRun = false;
}

function roleLabel(role) {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  return "System";
}

function buildPromptFromConversation() {
  const lines = [];
  const systemText = els.system.value.trim();
  if (systemText) {
    lines.push("System:", systemText, "");
  }
  for (const { role, content } of conversation) {
    lines.push(`${roleLabel(role)}:`);
    lines.push(content);
    lines.push("");
  }
  lines.push("Assistant:");
  return lines.join("\n");
}

function handleDeliveredPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  if (payload.kind === "run-selection-prompt") {
    queueAutoRun(payload);
    return;
  }

  const legacyPrompt = typeof payload.prompt === "string" ? payload.prompt : "";
  const legacyContext = typeof payload.pageContent === "string" ? payload.pageContent : "";
  if (legacyPrompt || legacyContext) {
    queueAutoRun({
      kind: "run-selection-prompt",
      suggestion: legacyPrompt,
      contextText: legacyContext,
      truncatedContext: legacyContext
    });
  }
}

function queueAutoRun(payload) {
  pendingAutoRuns.push(payload);
  processPendingAutoRuns();
}

async function loadCachedPayload() {
  if (!hasChromeSessionStorage) return;
  try {
    const obj = await chrome.storage.session.get(STORAGE_KEYS.POPUP_PAYLOAD);
    const payload = obj?.[STORAGE_KEYS.POPUP_PAYLOAD];
    if (!payload) return;
    await chrome.storage.session.remove(STORAGE_KEYS.POPUP_PAYLOAD);
    handleDeliveredPayload(payload);
  } catch (err) {
    console.warn("Failed to load cached payload:", err);
  }
}

function processPendingAutoRuns() {
  if (isStreaming || isProcessingAutoRun) return;
  const next = pendingAutoRuns.shift();
  if (!next) return;
  isProcessingAutoRun = true;
  runSelectionPrompt(next)
    .catch((err) => {
      console.warn("Auto-run failed:", err);
    })
    .finally(() => {
      isProcessingAutoRun = false;
      if (!isStreaming) {
        processPendingAutoRuns();
      }
    });
}

async function runSelectionPrompt(payload) {
  const suggestion = String(payload.suggestion || "").trim();
  const context =
    String(payload.truncatedContext || payload.contextText || "").trim();
  const pageTitle = String(payload.pageTitle || "").trim();
  const pageUrl = String(payload.pageUrl || "").trim();

  const lines = [];
  if (suggestion) lines.push(suggestion);
  if (context) {
    lines.push("", "Context:", context);
  }
  if (pageTitle || pageUrl) {
    const metaParts = [];
    if (pageTitle) metaParts.push(pageTitle);
    if (pageUrl) metaParts.push(pageUrl);
    lines.push("", `Source: ${metaParts.join(" — ")}`);
  }

  const combined = lines.join("\n").trim();
  if (!combined) return;

  await sendChatMessage(combined, { displayInInput: false });
}

document.addEventListener("DOMContentLoaded", async () => {
  updateControls();
  await restoreSystemPrompt();
  resetConversationUI();
  await maybeAutoInitModel();
  await loadCachedPayload();
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      chrome.runtime.sendMessage({ type: MSG.POPUP_READY }, () => {
        void chrome.runtime.lastError;
      });
    } catch (err) {
      console.warn("POPUP_READY dispatch failed:", err);
    }
  }
  processPendingAutoRuns();
});

els.init.addEventListener("click", async () => {
  if (client.isReady) return;
  els.init.disabled = true;
  try {
    await ensureModelReady();
  } catch {
    updateControls();
  }
});

async function sendChatMessage(userTextOverride, { displayInInput = false } = {}) {
  if (isStreaming) return;

  const overrideProvided = typeof userTextOverride === "string";
  const rawText = overrideProvided ? userTextOverride : els.prompt.value;
  const userText = (rawText || "").trim();
  if (!userText) return;

  if (!client.isReady) {
    try {
      await ensureModelReady({ auto: true });
    } catch {
      setStatus(UI_STRINGS.initFirst);
      return;
    }
  }

  if (!overrideProvided) {
    els.prompt.value = "";
  } else if (displayInInput) {
    els.prompt.value = userTextOverride;
  } else {
    els.prompt.value = "";
  }

  const userEntry = { role: "user", content: userText };
  createChatMessage("user", userText);
  conversation.push(userEntry);

  const assistantContentEl = createChatMessage("assistant", "");
  let assistantAccum = "";
  let assistantAdded = false;

  isStreaming = true;
  updateControls();
  setStatus("Generating…");

  try {
    for await (const chunk of client.promptStream(buildPromptFromConversation())) {
      assistantAccum += chunk;
      assistantContentEl.textContent = assistantAccum;
      scrollChatToBottom();
    }
    conversation.push({ role: "assistant", content: assistantAccum });
    assistantAdded = true;
    setStatus("Done");
  } catch (err) {
    if (err?.name === "AbortError") {
      assistantContentEl.textContent = "[stopped]";
      setStatus("Aborted");
    } else {
      assistantContentEl.textContent = `Error: ${err.message ?? err}`;
      setStatus(`Run error: ${err.message ?? err}`);
    }
  } finally {
    if (!assistantAdded) {
      conversation.pop();
    }
    isStreaming = false;
    updateControls();
    processPendingAutoRuns();
  }
}

els.send.addEventListener("click", () => {
  sendChatMessage().catch((err) => {
    console.warn("Send failed:", err);
  });
});

els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage().catch((err) => {
      console.warn("Send failed:", err);
    });
  }
});

els.stop.addEventListener("click", async () => {
  if (!isStreaming) return;
  try { client.abort(); } catch {}
  try {
    await ensureModelReady({ auto: true });
  } catch (err) {
    console.warn("Re-init after stop failed:", err);
  }
  processPendingAutoRuns();
});

els.reset.addEventListener("click", async () => {
  if (isStreaming) return;
  try { client.abort(); } catch {}
  resetConversationUI();
  setStatus("Session reset. Reinitializing…");
  try {
    await ensureModelReady({ auto: true });
    setStatus("Model ready.");
  } catch (err) {
    setStatus(`Re-init failed: ${err.message ?? err}`);
  }
});
