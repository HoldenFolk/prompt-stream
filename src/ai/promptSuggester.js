import { DEFAULTS, SYSTEM_SUGGESTER_TEXT } from "./constants.js";
import { parsePromptsJson, salvagePrompts } from "./jsonUtils.js";

/**
 * High-level service that uses a SessionManager-like object.
 * sessionMgr must expose: isReady, ensureReady({ systemText, ... }), prompt(text)
 */
export class PromptSuggester {
  #sessionMgr;

  constructor(sessionMgr) {
    this.#sessionMgr = sessionMgr;
  }

  async suggest(text, { tone = DEFAULTS.TONE, n = DEFAULTS.SUGGESTION_COUNT, onStatus } = {}) {
    const count = Math.min(Math.max(n, 1), DEFAULTS.MAX_SUGGESTION_COUNT);

    if (!this.#sessionMgr.isReady) {
      await this.#sessionMgr.ensureReady({ systemText: SYSTEM_SUGGESTER_TEXT, onStatus });
    }

    const msg = [
      `Tone: ${tone}. Number: ${count}.`,
      "Input text:",
      "<<<",
      text ?? "",
      ">>>",
      "Respond with JSON only."
    ].join("\n");

    const raw = await this.#sessionMgr.prompt(msg);
    const parsed = parsePromptsJson(raw);
    const prompts = parsed?.prompts?.length ? parsed.prompts : salvagePrompts(raw, count);

    // Enforce length & count
    const clipped = prompts
      .map(p => String(p).trim())
      .filter(Boolean)
      .map(p => p.length > DEFAULTS.MAX_PROMPT_LEN ? p.slice(0, DEFAULTS.MAX_PROMPT_LEN - 1) + "…" : p)
      .slice(0, count);

    return clipped;
  }
}
