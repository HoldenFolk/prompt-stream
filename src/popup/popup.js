import { DEFAULT_PARAMS, UI_STRINGS } from "../config.js";
import { ModelClient } from "../ai/modelClient.js";
import { els } from "../ui/dom.js";
import { setStatus, showProgress, setProgress } from "../ui/status.js";
import { getAvailability } from "../ai/apiShim.js";

const client = new ModelClient();

// Auto-init if model is already downloaded
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const availability = await getAvailability();

    if (availability === "available") {
      setStatus("Model already downloaded — initializing...");
      await client.ensureReady({
        systemText: els.system.value,
        params: DEFAULT_PARAMS,
        onStatus: setStatus,
        onProgress: setProgress,
      });
      setStatus("Model ready.");
      els.run.disabled = false;
    } else {
      setStatus("Click 'Init / Download model' to download Gemini Nano.");
      els.init.disabled = false;
    }
  } catch (e) {
    setStatus(`Auto-init check failed: ${e.message}`);
  }
});

// --- Config ---
const STORAGE_KEY = "systemPrompt";

// --- Helpers ---
function debounce(fn, delay = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

const storage = (() => {
  // Prefer chrome.storage.session; fallback to localStorage if not available (non-Chrome/older).
  const hasChromeSession = typeof chrome !== "undefined" &&
                           chrome.storage &&
                           chrome.storage.session &&
                           typeof chrome.storage.session.get === "function";

  return {
    async get(key) {
      if (hasChromeSession) {
        const obj = await chrome.storage.session.get(key);
        return obj[key];
      }
      return Promise.resolve(localStorage.getItem(key) ?? "");
    },
    async set(key, value) {
      if (hasChromeSession) {
        await chrome.storage.session.set({ [key]: value });
        return;
      }
      localStorage.setItem(key, value);
    }
  };
})();

// --- Main ---
document.addEventListener("DOMContentLoaded", async () => {
  const promptEl = els.system;

  // 1) Restore saved value when the popup opens
  try {
    const saved = (await storage.get(STORAGE_KEY)) ?? "";
    if (saved) {
      promptEl.value = saved;
      // If your UI reacts to input events (e.g., autosize), re-emit:
      promptEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch (e) {
    // Non-fatal; just log for debugging
    console.warn("Failed to restore prompt:", e);
  }

  // 2) Debounced saving on input
  const saveDraft = debounce(async (value) => {
    try {
      await storage.set(STORAGE_KEY, value);
    } catch (e) {
      console.warn("Failed to save prompt:", e);
    }
  }, 300);

  promptEl.addEventListener("input", () => {
    saveDraft(promptEl.value);
  });

  // Optional: save immediately on blur so nothing is lost if user closes fast
  promptEl.addEventListener("blur", () => {
    storage.set(STORAGE_KEY, promptEl.value).catch(() => {});
  });
});


// Manual init/download (first-time setup)
els.init.addEventListener("click", async () => {
  els.init.disabled = true;
  try {
    showProgress(true);
    await client.ensureReady({
      systemText: els.system.value,
      params: DEFAULT_PARAMS,
      onStatus: setStatus,
      onProgress: setProgress,
    });
    showProgress(false);
    setStatus("Model ready. Click any page element to run.");
  } catch (err) {
    setStatus(`Init error: ${err.message}`);
    showProgress(false);
    els.init.disabled = false;
  }
});

els.run.addEventListener("click", async () => {

  const systemText = els.system.value;
  const userText = els.prompt.value;

  await runPromptFromText(`${systemText}\n\n${userText}`);
});

async function runPromptFromText(text) {
  if (!client.isReady) {
    setStatus(UI_STRINGS.initFirst);
    console.log("system is not ready");
    return;
  }

  els.out.textContent = "";
  try {
    for await (const chunk of client.promptStream(text)) {
      els.out.textContent += chunk;
    }
    setStatus("Done");
  } catch (err) {
    setStatus(`Run error: ${err.message}`);
  }
}

els.stop.addEventListener("click", () => {
  try { client.abort(); } catch {}
  setStatus("Aborted");
});
