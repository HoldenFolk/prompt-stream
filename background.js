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
