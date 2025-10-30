import { ModelClient } from "../ai/modelClient.js";
import { DEFAULTS } from "../ai/constants.js";

const client = new ModelClient();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "OFFSCREEN_SUGGEST_PROMPTS") return;

  const { text = "", tone = DEFAULTS.TONE, n = DEFAULTS.SUGGESTION_COUNT } = msg;

  (async () => {
    try {
      const prompts = await client.suggestPromptsFor(text, { tone, n });
      sendResponse({ ok: true, prompts });
    } catch (err) {
      console.warn("Offscreen suggestion error:", err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();

  return true;
});
