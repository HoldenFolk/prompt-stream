import { getAvailability, createSession } from "./apiShim.js";

/**
 * Manages the Chrome Prompt API session lifecycle.
 * Accepts dependency injection for testability (getAvailability/createSession).
 */
export class SessionManager {
  #session = null;
  #controller = null;
  #deps;

  constructor(deps = { getAvailability, createSession }) {
    this.#deps = deps;
  }

  get isReady() { return !!this.#session; }

  async ensureReady({ systemText, onStatus, onProgress, params } = {}) {
    const availability = await this.#deps.getAvailability();
    onStatus?.(`Availability: ${availability}`);
    if (availability === "unavailable") throw new Error("Model unavailable on this device.");

    this.#controller = new AbortController();
    const hasSystem = !!(systemText && systemText.trim());

    this.#session = await this.#deps.createSession({
      signal: this.#controller.signal,
      ...(hasSystem ? { initialPrompts: [{ role: "system", content: systemText.trim() }] } : {}),
      ...(params || {}),
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const pct = Math.round((e.loaded ?? 0) * 100);
          onProgress?.(pct, e.loaded ?? 0);
          onStatus?.(`Downloading model… ${pct}%`);
        });
      },
    });

    onStatus?.("Model ready");
    return this.#session;
  }

  abort() {
    try {
      this.#controller?.abort();
      this.#session?.destroy?.();
    } catch {}
    this.#session = null;
  }

  async prompt(text = "") {
    if (!this.#session) throw new Error("Session not initialized.");
    return this.#session.prompt(text);
  }

  async *promptStream(text = "") {
    if (!this.#session) throw new Error("Session not initialized.");
    const stream = await this.#session.promptStreaming(text);
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock?.();
    }
  }
}
