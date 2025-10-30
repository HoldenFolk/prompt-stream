import { getAvailability, createSession } from "./apiShim.js";
import { USER_SETTINGS_KEYS, USER_SETTINGS_DEFAULTS } from "./constants.js";

const hasSyncStorage =
  typeof chrome !== "undefined" &&
  !!chrome.storage &&
  !!chrome.storage.sync &&
  typeof chrome.storage.sync.get === "function";

async function loadModelParams() {
  if (!hasSyncStorage) {
    return {
      temperature: USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TEMPERATURE],
      topK: USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TOP_K],
    };
  }

  const keys = [
    USER_SETTINGS_KEYS.MODEL_TEMPERATURE,
    USER_SETTINGS_KEYS.MODEL_TOP_K,
  ];

  const stored = await new Promise((resolve) => {
    chrome.storage.sync.get(keys, (items) => {
      if (chrome.runtime?.lastError) {
        resolve({});
        return;
      }
      resolve(items || {});
    });
  });

  const temperature = clampNumber(
    stored?.[USER_SETTINGS_KEYS.MODEL_TEMPERATURE],
    0,
    2,
    USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TEMPERATURE]
  );
  const topK = Math.round(clampNumber(
    stored?.[USER_SETTINGS_KEYS.MODEL_TOP_K],
    1,
    40,
    USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TOP_K]
  ));

  return { temperature, topK };
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

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
    if (this.#session) {
      onStatus?.("Model ready");
      return this.#session;
    }

    const availability = await this.#deps.getAvailability();
    onStatus?.(`Availability: ${availability}`);
    if (availability === "unavailable") throw new Error("Model unavailable on this device.");

    this.#controller = new AbortController();
    const hasSystem = !!(systemText && systemText.trim());

    const modelParams = params || await loadModelParams();

    this.#session = await this.#deps.createSession({
      signal: this.#controller.signal,
      ...(hasSystem ? { initialPrompts: [{ role: "system", content: systemText.trim() }] } : {}),
      ...(modelParams ? { params: modelParams } : {}),
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
    this.#controller = null;
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
