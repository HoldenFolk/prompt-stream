import { SessionManager } from "./sessionManager.js";
import { PromptSuggester } from "./promptSuggester.js";
import { SYSTEM_SUGGESTER_TEXT } from "./constants.js";

export class ModelClient {
  #sessionMgr;
  #suggester;

  constructor(deps) {
    this.#sessionMgr = new SessionManager(deps);
    this.#suggester   = new PromptSuggester(this.#sessionMgr);
  }

  get isReady() { return this.#sessionMgr.isReady; }

  ensureReady(opts) { return this.#sessionMgr.ensureReady(opts); }
  abort() { return this.#sessionMgr.abort(); }
  prompt(text) { return this.#sessionMgr.prompt(text); }
  promptStream(text) { return this.#sessionMgr.promptStream(text); }

  /** NEW: same name as before, but routed to the modular service */
  async suggestPromptsFor(text, { tone, n, onStatus } = {}) {
    // If someone passes in systemText via ensureReady elsewhere, we won’t override; otherwise set it here.
    if (!this.isReady) {
      await this.ensureReady({ systemText: SYSTEM_SUGGESTER_TEXT, onStatus });
    }
    return this.#suggester.suggest(text, { tone, n, onStatus });
  }
}
