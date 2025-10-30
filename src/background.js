// background.js (service worker)
import { MSG, STORAGE_KEYS } from "./ai/constants.js";

const offscreenState = {
  ready: false,
  promise: null,
  resolve: null,
  pingScheduled: false
};

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function resetOffscreenReady() {
  const deferred = createDeferred();
  offscreenState.ready = false;
  offscreenState.promise = deferred.promise;
  offscreenState.resolve = deferred.resolve;
  offscreenState.pingScheduled = false;
}

function markOffscreenReady() {
  if (offscreenState.ready) return;
  offscreenState.ready = true;
  offscreenState.resolve?.();
  offscreenState.promise = null;
  offscreenState.resolve = null;
  offscreenState.pingScheduled = false;
}

function ensureOffscreenDeferred() {
  if (!offscreenState.promise) {
    const deferred = createDeferred();
    offscreenState.promise = deferred.promise;
    offscreenState.resolve = deferred.resolve;
    offscreenState.pingScheduled = false;
  }
}

function pingOffscreenDocument() {
  if (!chrome?.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage(
      { type: MSG.OFFSCREEN_PING },
      () => {
        void chrome.runtime?.lastError;
      }
    );
  } catch (err) {
    console.warn("Offscreen ping failed:", err);
  }
}

async function waitForOffscreenReady() {
  if (offscreenState.ready) return;
  ensureOffscreenDeferred();
  if (!offscreenState.pingScheduled) {
    offscreenState.pingScheduled = true;
    pingOffscreenDocument();
  }
  await offscreenState.promise;
}

resetOffscreenReady();

// Opens Gemini and injects the provided prompt into the input box.
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (!msg || msg.type !== "OPEN_GEMINI" || typeof msg.prompt !== "string") return;

  const targetUrl = "https://gemini.google.com/app";

  chrome.tabs.create({ url: targetUrl }, (tab) => {
    if (!tab || !tab.id) return;

    // We’ll try to inject once the page reports 'complete'
    const onUpdated = (tabId, changeInfo, tabInfo) => {
      if (tabId !== tab.id) return;
      if (changeInfo.status !== "complete") return;
      if (!/^https:\/\/gemini\.google\.com\/app/.test(tabInfo.url || "")) return;

      chrome.tabs.onUpdated.removeListener(onUpdated);

      // Retry a few times in case Gemini’s UI mounts a bit later
      let attempts = 0;
      const maxAttempts = 6; // ~3s total
      const tryInject = () => {
        attempts += 1;
        chrome.scripting.executeScript(
          {
            target: { tabId },
            func: (text) => {
              // Try common selectors Gemini uses for input areas
              const candidates = [
                'textarea[aria-label]',
                'textarea',
                '[contenteditable="true"][role="textbox"]',
                '[role="textbox"]'
              ];
              let input = null;
              for (const sel of candidates) {
                const el = document.querySelector(sel);
                if (el) {
                  input = el;
                  break;
                }
              }
              if (!input) return false;

              // Set value for <textarea> or contenteditable
              const setValue = (el, val) => {
                const isTextarea = el.tagName === "TEXTAREA" || typeof el.value === "string";
                el.focus();
                if (isTextarea) {
                  el.value = val;
                } else {
                  el.innerHTML = "";
                  el.textContent = val;
                }
                // Fire input event so frameworks pick up the change
                el.dispatchEvent(new InputEvent("input", { bubbles: true }));
                el.scrollIntoView({ behavior: "smooth", block: "center" });
              };

              setValue(input, text);
              return true;
            },
            args: [msg.prompt]
          },
          (results) => {
            const ok = Array.isArray(results) && results[0] && results[0].result === true;
            if (!ok && attempts < maxAttempts) {
              setTimeout(tryInject, 500);
            }
          }
        );
      };

      tryInject();
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
});

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error("Offscreen API unavailable.");
  }

  const hasDoc = await chrome.offscreen.hasDocument?.();
  if (hasDoc) {
    await waitForOffscreenReady();
    return;
  }

  resetOffscreenReady();

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL("src/offscreen/offscreen.html"),
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: "Generate Gemini prompt suggestions for selections."
  });

  await waitForOffscreenReady();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestPromptSuggestions({ text, tone, n }) {
  await ensureOffscreenDocument();

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "OFFSCREEN_SUGGEST_PROMPTS",
        text,
        tone,
        n
      });
      if (!response || response.ok !== true) {
        const error = response?.error ? String(response.error) : "Unknown error";
        throw new Error(error);
      }
      return response.prompts ?? [];
    } catch (err) {
      const message = String(err?.message || err);
      const canRetry = message.includes("Receiving end does not exist") && attempt < maxAttempts - 1;
      if (!canRetry) throw err;
      await sleep(150);
    }
  }
  throw new Error("Unable to reach offscreen document.");
}

async function deliverPayloadToChat(payload, sender) {
  const existingTab = await findChatTab();
  if (existingTab) {
    await focusChatTab(existingTab);
    chrome.runtime.sendMessage({ type: MSG.POPUP_PAYLOAD_DELIVER, payload });
    return "direct";
  }

  await chrome.storage.session.set({ [STORAGE_KEYS.POPUP_PAYLOAD]: payload });
  await openChatTab(sender);
  return "queued";
}

function broadcastModelReady() {
  if (!chrome?.tabs?.query) return;
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime?.lastError) {
      console.warn("tabs.query failed while broadcasting model ready:", chrome.runtime.lastError);
      return;
    }
    (tabs || []).forEach((tab) => {
      if (!tab || typeof tab.id !== "number") return;
      try {
        chrome.tabs.sendMessage(
          tab.id,
          { type: MSG.MODEL_READY },
          () => {
            void chrome.runtime?.lastError;
          }
        );
      } catch (err) {
        console.warn("tabs.sendMessage failed:", err);
      }
    });
  });
}

async function findChatTab() {
  const targetUrl = chrome.runtime.getURL("src/popup/tab.html");
  try {
    const tabs = await chrome.tabs.query({ url: targetUrl });
    if (Array.isArray(tabs) && tabs.length > 0) {
      return tabs[0];
    }
  } catch (err) {
    console.warn("tabs.query failed while locating chat tab:", err);
  }
  return null;
}

async function focusChatTab(tab) {
  if (!tab || typeof tab.id !== "number") return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
  } catch (err) {
    console.warn("Unable to activate chat tab:", err);
  }
  if (typeof tab.windowId === "number") {
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (err) {
      console.warn("Unable to focus chat window:", err);
    }
  }
}

async function openChatTab(sender) {
  const targetUrl = chrome.runtime.getURL("src/popup/tab.html");
  const createProps = {
    url: targetUrl,
    active: true
  };

  if (sender?.tab?.windowId) {
    createProps.windowId = sender.tab.windowId;
  }

  try {
    await chrome.tabs.create(createProps);
  } catch (err) {
    console.warn("tabs.create failed while opening chat tab:", err);
    throw err;
  }
}

/*
Is called with a text and tone and "N". The text is the highlighted text that the user selects and the tone 
is the tone for the model response, and the N is the numebr of responses
*/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "OPEN_POPUP_WINDOW") {
    const payload = msg.payload ?? {};
    (async () => {
      try {
        const delivered = await deliverPayloadToChat(payload, sender);
        sendResponse?.({ ok: true, delivered });
      } catch (err) {
        console.warn("OPEN_POPUP_WINDOW error:", err);
        await chrome.storage.session.set({ [STORAGE_KEYS.POPUP_PAYLOAD]: payload });
        sendResponse?.({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (msg?.type === "SUGGEST_PROMPTS") {
    const { text, tone, n } = msg || {};
    (async () => {
      try {
        const prompts = await requestPromptSuggestions({
          text: text ?? "",
          tone,
          n
        });
        sendResponse({ ok: true, prompts });
      } catch (err) {
        console.warn("SUGGEST_PROMPTS error:", err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // keep the message channel open for async response
  }
});

/*
This listener take a "prompt" and a "pageContent". I will then use this in the popup and generate the resopnse for the user.
*/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === MSG.OFFSCREEN_READY) {
    markOffscreenReady();
    sendResponse?.({ ok: true });
    return;
  }

  if (msg?.type === MSG.MODEL_READY) {
    broadcastModelReady();
    sendResponse?.({ ok: true });
    return;
  }

  if (msg?.type === "CS_TO_BG_SEND_TO_POPUP") {
    const payload = msg.payload ?? { prompt: "", pageContent: "" };

    (async () => {
      try {
        const delivered = await deliverPayloadToChat(payload, sender);
        sendResponse({ ok: true, delivered });
      } catch (err) {
        console.warn("openPopup error:", err);
        // Fallback: if openPopup fails, at least cache so the popup can pull it next time it opens.
        await chrome.storage.session.set({ [STORAGE_KEYS.POPUP_PAYLOAD]: payload });
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();

    return true; // keep channel open for async sendResponse
  }

  // One-shot handshake: popup tells us it's ready; we pass any cached payload.
  if (msg?.type === "POPUP_READY") {
    (async () => {
      const obj = await chrome.storage.session.get(STORAGE_KEYS.POPUP_PAYLOAD);
      const cached = obj?.[STORAGE_KEYS.POPUP_PAYLOAD];
      if (cached) {
        chrome.runtime.sendMessage({ type: "POPUP_PAYLOAD_DELIVER", payload: cached });
        await chrome.storage.session.remove(STORAGE_KEYS.POPUP_PAYLOAD);
      }
    })();
    // No sendResponse needed
  }
});


