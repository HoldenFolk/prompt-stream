// background.js (service worker)
import { ModelClient } from "./modelClient.js";
import { MSG, STORAGE_KEYS } from "./ai/constants.js";

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

const client = new ModelClient();


/*
Is called with a text and tone and "N". The text is the highlighted text that the user selects and the tone 
is the tone for the model response, and the N is the numebr of responses
*/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SUGGEST_PROMPTS") {
    const { text, tone, n } = msg || {};
    (async () => {
      try {
        const prompts = await client.suggestPromptsFor(text ?? "", { tone, n });
        sendResponse({ ok: true, prompts });
      } catch (err) {
        console.warn("SUGGEST_PROMPTS error:", err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true; // keep the message channel open for async response
  }
});

// Keys you already have
const STORAGE_KEYS = { POPUP_PAYLOAD: "popup-payload" };


/* 
This listener take a "prompt" and a "pageContent". I will then use this in the popup and generate the resopnse for the user.
*/
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "CS_TO_BG_SEND_TO_POPUP") {
    const payload = msg.payload ?? { prompt: "", pageContent: "" };

    (async () => {
      try {
        const views = await chrome.runtime.getViews({ type: "popup" });

        if (views.length > 0) {
          // Popup already open → deliver immediately
          chrome.runtime.sendMessage({ type: "POPUP_PAYLOAD_DELIVER", payload });
        } else {
          // Popup closed → cache then open it
          await chrome.storage.session.set({ [STORAGE_KEYS.POPUP_PAYLOAD]: payload });

          await chrome.action.openPopup(
            sender?.tab?.windowId ? { windowId: sender.tab.windowId } : {}
          );
          // When the popup initializes, it will ask for POPUP_READY and we'll deliver from storage.
        }

        sendResponse({ ok: true });
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


