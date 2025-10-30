import { ModelClient } from "../ai/modelClient.js";
import { DEFAULTS, MSG } from "../ai/constants.js";

const client = new ModelClient();
let suggestionQueue = Promise.resolve();

function notifyReady() {
  try {
    chrome.runtime?.sendMessage?.(
      { type: MSG.OFFSCREEN_READY },
      () => {
        void chrome.runtime?.lastError;
      }
    );
  } catch (err) {
    console.warn("Failed to notify background that offscreen is ready:", err);
  }
}

notifyReady();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === MSG.OFFSCREEN_PING) {
    notifyReady();
    sendResponse?.({ ok: true });
    return;
  }

  if (msg?.type !== "OFFSCREEN_SUGGEST_PROMPTS") return;

  const { text = "", tone = DEFAULTS.TONE, n = DEFAULTS.SUGGESTION_COUNT } = msg;

  const job = suggestionQueue
    .catch(() => {})
    .then(() => client.suggestPromptsFor(text, { tone, n }));

  suggestionQueue = job.catch(() => {});

  job
    .then((prompts) => {
      sendResponse({ ok: true, prompts });
    })
    .catch((err) => {
      console.warn("Offscreen suggestion error:", err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    })
    .finally(() => {
      notifyReady();
    });

  return true;
});
