/**
 * Small compatibility shim to abstract Chrome Prompt API surfaces
 * across contexts (window, service worker) and versions.
 */
function getGlobalObject() {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;
  if (typeof self !== "undefined") return self;
  return null;
}

function getApiRoot() {
  const root = getGlobalObject();
  if (!root) return null;
  if (root.ai?.languageModel) return root.ai.languageModel;
  if (root.LanguageModel) return root.LanguageModel;
  return null;
}

/**
 * Return availability/capabilities in a normalized way.
 * Normalized values:
 *  - "unavailable"
 *  - "downloadable" (needs download)
 *  - "downloading"
 *  - "available"
 */
export async function getAvailability() {
  const api = getApiRoot();
  if (!api) return "unavailable";

  // Newer API might expose availability()
  if (typeof api.availability === "function") {
    try {
      return await api.availability();
    } catch {
      // fall through
    }
  }

  // Older API: capabilities() → { available: "readily" | "after-download" | "no" }
  if (typeof api.capabilities === "function") {
    try {
      const caps = await api.capabilities();
      const v = caps?.available;
      if (v === "readily") return "available";
      if (v === "after-download") return "downloadable";
      return "unavailable";
    } catch {
      /* ignore */
    }
  }

  return "unavailable";
}

/**
 * Create a session with optional options (initialPrompts, monitor, signal, params).
 * Returns the raw session, which should have prompt() / promptStreaming() / destroy()
 */
export async function createSession(options = {}) {
  const api = getApiRoot();
  if (!api) throw new Error("Prompt API not found in this context.");
  if (typeof api.create !== "function") {
    throw new Error("This Chrome version does not support session creation.");
  }
  return api.create(options);
}
