import {
  MSG,
  USER_SETTINGS_KEYS,
  USER_SETTINGS_DEFAULTS,
} from "../ai/constants.js";
import { ModelClient } from "../ai/modelClient.js";
import { getAvailability } from "../ai/apiShim.js";

const storageArea = (() => {
  if (typeof chrome === "undefined" || !chrome.storage) return null;
  if (chrome.storage.sync && typeof chrome.storage.sync.get === "function") {
    return chrome.storage.sync;
  }
  if (chrome.storage.local && typeof chrome.storage.local.get === "function") {
    return chrome.storage.local;
  }
  return null;
})();

const localStorageFallback = typeof window !== "undefined" ? window.localStorage : null;
const VALID_TONES = ["neutral", "friendly", "professional", "persuasive", "casual"];
const STORAGE_KEYS = {
  MODEL_READY: "modelReady",
};

const modelClient = new ModelClient();

const hasChromeSessionStorage =
  typeof chrome !== "undefined" &&
  !!chrome.storage &&
  !!chrome.storage.session &&
  typeof chrome.storage.session.get === "function";

const sessionStore = (() => {
  if (hasChromeSessionStorage) {
    return {
      async get(key) {
        const obj = await chrome.storage.session.get(key);
        return Boolean(obj[key]);
      },
      async set(key, value) {
        if (!value) {
          await chrome.storage.session.remove(key);
          return;
        }
        await chrome.storage.session.set({ [key]: true });
      },
      async remove(key) {
        await chrome.storage.session.remove(key);
      },
    };
  }

  let fallback = null;
  try {
    fallback = typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    fallback = null;
  }

  return {
    async get(key) {
      if (!fallback) return false;
      return fallback.getItem(key) === "true";
    },
    async set(key, value) {
      if (!fallback) return;
      if (value) {
        fallback.setItem(key, "true");
      } else {
        fallback.removeItem(key);
      }
    },
    async remove(key) {
      if (!fallback) return;
      fallback.removeItem(key);
    },
  };
})();

let modelReady = false;
let initInProgress = false;
let disableInitButton = false;

const els = {
  system: document.getElementById("system"),
  suggestionCount: document.getElementById("suggestionCount"),
  suggestionCountValue: document.getElementById("suggestionCountValue"),
  suggestionTone: document.getElementById("suggestionTone"),
  temperature: document.getElementById("temperature"),
  temperatureValue: document.getElementById("temperatureValue"),
  topK: document.getElementById("topK"),
  topKValue: document.getElementById("topKValue"),
  openWorkspace: document.getElementById("openWorkspace"),
  reset: document.getElementById("resetSettings"),
  saveStatus: document.getElementById("saveStatus"),
  initModel: document.getElementById("initModel"),
  initStatus: document.getElementById("initStatus"),
  initProgressWrap: document.getElementById("initProgressWrap"),
  initProgress: document.getElementById("initProgress"),
  initProgressNote: document.getElementById("initProgressNote"),
};

const SAVE_DEBOUNCE_MS = 300;
let saveTimer = null;

function debounceSave(fn) {
  return (...args) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fn(...args), SAVE_DEBOUNCE_MS);
  };
}

async function storageGet(keys) {
  if (storageArea) {
    return new Promise((resolve) => {
      storageArea.get(keys, (items) => {
        if (chrome.runtime?.lastError) {
          resolve({});
          return;
        }
        resolve(items || {});
      });
    });
  }
  const result = {};
  keys.forEach((key) => {
    const value = localStorageFallback?.getItem(key);
    if (value !== null) result[key] = parseStoredValue(value);
  });
  return result;
}

async function storageSet(pairs) {
  if (storageArea) {
    await new Promise((resolve) => {
      storageArea.set(pairs, () => {
        if (chrome.runtime?.lastError) {
          console.warn("Failed to persist settings:", chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }
  if (localStorageFallback) {
    Object.entries(pairs).forEach(([key, value]) => {
      try {
        localStorageFallback.setItem(key, JSON.stringify(value));
      } catch {}
    });
  }
}

function parseStoredValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

async function loadSettings() {
  const keys = Object.values(USER_SETTINGS_KEYS);
  const stored = await storageGet(keys);
  const settings = { ...USER_SETTINGS_DEFAULTS, ...stored };
  settings[USER_SETTINGS_KEYS.SUGGESTION_COUNT] = clamp(
    settings[USER_SETTINGS_KEYS.SUGGESTION_COUNT],
    1,
    5,
    USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SUGGESTION_COUNT]
  );
  settings[USER_SETTINGS_KEYS.MODEL_TEMPERATURE] = clamp(
    settings[USER_SETTINGS_KEYS.MODEL_TEMPERATURE],
    0,
    2,
    USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TEMPERATURE]
  );
  settings[USER_SETTINGS_KEYS.MODEL_TOP_K] = clamp(
    settings[USER_SETTINGS_KEYS.MODEL_TOP_K],
    1,
    40,
    USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TOP_K]
  );
  const tone = settings[USER_SETTINGS_KEYS.SUGGESTION_TONE];
  if (!tone || typeof tone !== "string") {
    settings[USER_SETTINGS_KEYS.SUGGESTION_TONE] = USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SUGGESTION_TONE];
  }
  return settings;
}

function applySettingsToUI(settings) {
  els.system.value = settings[USER_SETTINGS_KEYS.SYSTEM_PROMPT] ?? "";
  els.suggestionCount.value = String(settings[USER_SETTINGS_KEYS.SUGGESTION_COUNT]);
  els.suggestionCountValue.textContent = settings[USER_SETTINGS_KEYS.SUGGESTION_COUNT];
  const toneValue = settings[USER_SETTINGS_KEYS.SUGGESTION_TONE] ?? "neutral";
  if (els.suggestionTone) {
    const validOption = Array.from(els.suggestionTone.options || []).some((opt) => opt.value === toneValue);
    els.suggestionTone.value = validOption ? toneValue : "neutral";
  }
  els.temperature.value = String(settings[USER_SETTINGS_KEYS.MODEL_TEMPERATURE]);
  els.temperatureValue.textContent = Number(settings[USER_SETTINGS_KEYS.MODEL_TEMPERATURE]).toFixed(1);
  els.topK.value = String(settings[USER_SETTINGS_KEYS.MODEL_TOP_K]);
  els.topKValue.textContent = settings[USER_SETTINGS_KEYS.MODEL_TOP_K];
}

const saveSystemPrompt = debounceSave(async (value) => {
  await storageSet({ [USER_SETTINGS_KEYS.SYSTEM_PROMPT]: value.trim() });
  showStatus("System prompt saved");
});

const saveSuggestionCount = debounceSave(async (value) => {
  const count = clamp(value, 1, 5, USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SUGGESTION_COUNT]);
  await storageSet({ [USER_SETTINGS_KEYS.SUGGESTION_COUNT]: count });
  if (els.suggestionCount) {
    els.suggestionCount.value = String(count);
  }
  els.suggestionCountValue.textContent = count;
  showStatus("Suggestion settings updated");
});

const saveSuggestionTone = debounceSave(async (value) => {
  const tone =
    typeof value === "string" && VALID_TONES.includes(value)
      ? value
      : USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SUGGESTION_TONE];
  await storageSet({ [USER_SETTINGS_KEYS.SUGGESTION_TONE]: tone });
  showStatus("Suggestion settings updated");
});

const saveTemperature = debounceSave(async (value) => {
  const temp = clamp(value, 0, 2, USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TEMPERATURE]);
  await storageSet({ [USER_SETTINGS_KEYS.MODEL_TEMPERATURE]: temp });
  if (els.temperature) {
    els.temperature.value = String(temp);
  }
  els.temperatureValue.textContent = temp.toFixed(1);
  showStatus("Model parameters saved");
});

const saveTopK = debounceSave(async (value) => {
  const topK = clamp(value, 1, 40, USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TOP_K]);
  await storageSet({ [USER_SETTINGS_KEYS.MODEL_TOP_K]: topK });
  if (els.topK) {
    els.topK.value = String(topK);
  }
  els.topKValue.textContent = topK;
  showStatus("Model parameters saved");
});

function showStatus(message) {
  if (!els.saveStatus) return;
  els.saveStatus.textContent = message;
  clearTimeout(showStatus._timer);
  showStatus._timer = setTimeout(() => {
    els.saveStatus.textContent = "";
  }, 2000);
}

function resetToDefaults() {
  applySettingsToUI(USER_SETTINGS_DEFAULTS);
  storageSet({
    [USER_SETTINGS_KEYS.SYSTEM_PROMPT]: USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SYSTEM_PROMPT],
    [USER_SETTINGS_KEYS.SUGGESTION_COUNT]: USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SUGGESTION_COUNT],
    [USER_SETTINGS_KEYS.SUGGESTION_TONE]: USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.SUGGESTION_TONE],
    [USER_SETTINGS_KEYS.MODEL_TEMPERATURE]: USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TEMPERATURE],
    [USER_SETTINGS_KEYS.MODEL_TOP_K]: USER_SETTINGS_DEFAULTS[USER_SETTINGS_KEYS.MODEL_TOP_K],
  }).then(() => showStatus("Settings reset"));
}

function setInitStatus(message) {
  if (!els.initStatus) return;
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) {
    els.initStatus.textContent = "Status: Not initialized";
    return;
  }
  els.initStatus.textContent = text.startsWith("Status:") ? text : `Status: ${text}`;
}

function showInitProgress(show) {
  if (!els.initProgressWrap) return;
  els.initProgressWrap.classList.toggle("hidden", !show);
  if (!show) {
    if (els.initProgress) {
      els.initProgress.value = 0;
    }
    if (els.initProgressNote) {
      els.initProgressNote.textContent = "";
    }
  }
}

function setInitProgress(pct, loadedFraction) {
  if (els.initProgress) {
    const value = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    els.initProgress.value = value;
  }
  if (els.initProgressNote) {
    if (typeof loadedFraction === "number") {
      els.initProgressNote.textContent = `Loaded: ${(loadedFraction * 100).toFixed(1)}%`;
    } else if (!initInProgress) {
      els.initProgressNote.textContent = "";
    }
  }
}

function updateInitControls() {
  if (!els.initModel) return;
  els.initModel.disabled = disableInitButton || initInProgress || modelReady;
}

async function persistModelReadyFlag(isReady) {
  try {
    await sessionStore.set(STORAGE_KEYS.MODEL_READY, isReady);
  } catch (err) {
    console.warn("Unable to persist model ready flag:", err);
  }
}

function notifyModelReadyBroadcast() {
  try {
    chrome.runtime?.sendMessage?.(
      { type: MSG.MODEL_READY },
      () => {
        void chrome.runtime?.lastError;
      }
    );
  } catch (err) {
    console.warn("Model ready broadcast failed:", err);
  }
}

async function ensureModelReadyFromSettings() {
  if (!els.initModel || initInProgress) return;

  initInProgress = true;
  disableInitButton = true;
  setInitStatus("Preparing model…");
  setInitProgress(0);
  showInitProgress(true);
  updateInitControls();

  try {
    await modelClient.ensureReady({
      systemText: els.system?.value,
      onStatus: (status) => setInitStatus(status),
      onProgress: (pct, fraction) => {
        setInitProgress(pct, fraction);
        showInitProgress(true);
      },
    });
    modelReady = true;
    await persistModelReadyFlag(true);
    setInitStatus("Model ready.");
    notifyModelReadyBroadcast();
  } catch (err) {
    modelReady = false;
    await persistModelReadyFlag(false);
    const message = err?.message ? String(err.message) : String(err ?? "Unknown error");
    setInitStatus(`Init error: ${message}`);
  } finally {
    initInProgress = false;
    disableInitButton = false;
    showInitProgress(false);
    if (!modelReady) {
      setInitProgress(0);
    }
    updateInitControls();
  }
}

async function refreshModelStatus() {
  if (!els.initModel) return;
  disableInitButton = false;

  try {
    const storedReady = await sessionStore.get(STORAGE_KEYS.MODEL_READY);
    modelReady = modelClient.isReady || Boolean(storedReady);
  } catch (err) {
    modelReady = modelClient.isReady;
    console.warn("Model ready flag check failed:", err);
  }

  if (modelReady) {
    setInitStatus("Model ready.");
    showInitProgress(false);
    updateInitControls();
    return;
  }

  try {
    const availability = await getAvailability();
    switch (availability) {
      case "available":
        setInitStatus("Model downloaded — ready to initialize.");
        break;
      case "downloading":
        setInitStatus("Model download in progress. Check back shortly.");
        disableInitButton = true;
        showInitProgress(true);
        break;
      case "downloadable":
        setInitStatus("Click 'Init / Download model' to download Gemini Nano.");
        break;
      default:
        setInitStatus("Model unavailable on this device.");
        disableInitButton = true;
        break;
    }
  } catch (err) {
    const message = err?.message ? String(err.message) : String(err ?? "Unknown error");
    setInitStatus(`Availability check failed: ${message}`);
  } finally {
    updateInitControls();
    if (!initInProgress && !disableInitButton) {
      showInitProgress(false);
    }
  }
}

function openWorkspace() {
  const fallbackUrl = chrome?.runtime?.getURL
    ? chrome.runtime.getURL("src/popup/tab.html")
    : "src/popup/tab.html";
  try {
    if (chrome?.tabs?.create) {
      chrome.tabs.create({ url: fallbackUrl });
    } else if (typeof window !== "undefined") {
      window.open(fallbackUrl, "_blank");
    }
  } catch (err) {
    console.warn("Unable to open workspace tab:", err);
    if (typeof window !== "undefined") {
      window.open(fallbackUrl, "_blank");
    }
  }
}

(async function init() {
  const settings = await loadSettings();
  applySettingsToUI(settings);

  els.system?.addEventListener("input", (event) => {
    saveSystemPrompt(event.target.value);
  });

  els.suggestionCount?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    els.suggestionCountValue.textContent = value;
  });
  els.suggestionCount?.addEventListener("change", (event) => {
    saveSuggestionCount(Number(event.target.value));
  });

  els.suggestionTone?.addEventListener("change", (event) => {
    saveSuggestionTone(event.target.value);
  });

  els.temperature?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    els.temperatureValue.textContent = value.toFixed(1);
  });
  els.temperature?.addEventListener("change", (event) => {
    saveTemperature(Number(event.target.value));
  });

  els.topK?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    els.topKValue.textContent = value;
  });
  els.topK?.addEventListener("change", (event) => {
    saveTopK(Number(event.target.value));
  });

  els.reset?.addEventListener("click", () => {
    resetToDefaults();
  });

  els.openWorkspace?.addEventListener("click", () => {
    openWorkspace();
  });

  els.initModel?.addEventListener("click", () => {
    ensureModelReadyFromSettings();
  });

  await refreshModelStatus();
})();
