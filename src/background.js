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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "CS_TO_BG_SEND_TO_POPUP") {
    const payload = msg.payload ?? { prompt: "", pageContent: "" };
    (async () => {
      // Try to deliver live to any open popup
      const views = await chrome.runtime.getViews({ type: "popup" });
      if (views.length > 0) {
        // Popup is open — broadcast
        chrome.runtime.sendMessage({ type: "POPUP_PAYLOAD_DELIVER", payload });
      } else {
        // Popup closed — cache in session storage
        await chrome.storage.session.set({ [STORAGE_KEYS.POPUP_PAYLOAD]: payload });
      }
      sendResponse({ ok: true });
    })();
    return true; // async
  }
});

