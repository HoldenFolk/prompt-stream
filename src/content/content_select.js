(function () {
  const TAG_ID = "gemini-selection-tag";
  const STYLE_ID = "gemini-selection-style";
  const DEFAULT_MAX_LEN = 500;
  const MIN_SELECTION_LENGTH = 5;
  const DEFAULT_DIALOG_WIDTH = 260;
  const ELLIPSIS = "...";
  const SELECT_ALL_KEY = "a";
  const KEYBOARD_SELECTION_KEYS = new Set(["Shift", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
  const POSITION_OFFSET = 8;
  const TRANSITION_MS = 200;
  const DIALOG_TITLE = "Suggested prompts:";
  const DEFAULT_TONE = "neutral";
  const MAX_SUGGESTION_COUNT = 5;
  const DEFAULT_SUGGESTION_COUNT = 3;
  const FALLBACK_PROMPTS = Array.from({ length: MAX_SUGGESTION_COUNT }, (_unused, index) => `Sample prompt ${index + 1}`);
  const LOADING_PROMPTS = ["Loading suggestions…"];
  const SETTINGS_KEYS = {
    SUGGESTION_COUNT: "suggestionCount",
    SUGGESTION_TONE: "suggestionTone"
  };
  const VALID_TONES = new Set(["neutral", "friendly", "professional", "persuasive", "casual"]);

  const state = {
    maxLen: DEFAULT_MAX_LEN,
    baseUrl: "https://gemini.google.com/app",
    prefix: "Explain this:\n\n",
    suggestionCount: DEFAULT_SUGGESTION_COUNT,
    tone: DEFAULT_TONE
  };

  let tagElement = null;
  let suggestionRequestCounter = 0;
  let storageListenerRegistered = false;

  init();

  function init() {
    const storage = getStorageArea();
    if (storage) {
      loadSettings(storage);
      return;
    }
    setup();
  }

  function getStorageArea() {
    if (typeof chrome === "undefined" || !chrome.storage) return null;
    if (chrome.storage.sync && typeof chrome.storage.sync.get === "function") {
      return chrome.storage.sync;
    }
    if (chrome.storage.local && typeof chrome.storage.local.get === "function") {
      return chrome.storage.local;
    }
    return null;
  }

  function loadSettings(storage) {
    try {
      storage.get(
        [
          "maxLen",
          "baseUrl",
          "prefix",
          SETTINGS_KEYS.SUGGESTION_COUNT,
          SETTINGS_KEYS.SUGGESTION_TONE
        ],
        function (cfg) {
          applyConfig(cfg);
          registerStorageListener();
          setup();
        }
      );
    } catch (err) {
      registerStorageListener();
      setup();
    }
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (typeof cfg.maxLen === "number") state.maxLen = cfg.maxLen;
    if (typeof cfg.baseUrl === "string" && cfg.baseUrl) state.baseUrl = cfg.baseUrl;
    if (typeof cfg.prefix === "string") state.prefix = cfg.prefix;
    if (cfg[SETTINGS_KEYS.SUGGESTION_COUNT] !== undefined) {
      state.suggestionCount = clampSuggestionCount(cfg[SETTINGS_KEYS.SUGGESTION_COUNT]);
    }
    if (cfg.hasOwnProperty(SETTINGS_KEYS.SUGGESTION_TONE)) {
      const rawTone = cfg[SETTINGS_KEYS.SUGGESTION_TONE];
      if (typeof rawTone === "string") {
        const tone = rawTone.trim();
        state.tone = VALID_TONES.has(tone) ? tone : DEFAULT_TONE;
      }
    }
  }

  function setup() {
    tagElement = ensureTagElement();
    injectTagStyles();
    attachSelectionListeners();
    attachViewportListeners();
    updateButtonLimit();
  }

  function ensureTagElement() {
    const existing = document.getElementById(TAG_ID);
    if (existing) return existing;

    const el = document.createElement("div");
    el.id = TAG_ID;
    el.style.display = "none";
    el.dataset.selectionPrompt = "";

    const title = document.createElement("div");
    title.className = "gemini-dialog-title";
    title.textContent = DIALOG_TITLE;
    el.appendChild(title);

    const optionsContainer = document.createElement("div");
    optionsContainer.className = "gemini-dialog-options";
    el.appendChild(optionsContainer);

    const optionButtons = new Array(MAX_SUGGESTION_COUNT).fill(null).map(function (_unused, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.optionIndex = String(index);
      button.style.display = "none";
      button.style.whiteSpace = "normal";
      button.style.wordBreak = "break-word";
      button.style.textAlign = "left";
      button.style.height = "auto";
      button.style.minHeight = "auto";
      button.disabled = true;
      button.addEventListener("click", handleOptionClick);
      optionsContainer.appendChild(button);
      return button;
    });

    el._optionButtons = optionButtons;

    document.documentElement.appendChild(el);
    return el;
  }

  function injectTagStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      `#${TAG_ID} {`,
      "  position: absolute;",
      "  z-index: 2147483647;",
      "  background: #f2f2f2;",
      "  border: 1px solid #d9d9d9;",
      "  border-radius: 12px;",
      "  padding: 12px;",
      "  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;",
      "  color: #333;",
      "  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);",
      "  user-select: none;",
      "  max-width: min(420px, 90vw);",
      "  width: fit-content;",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 8px;",
      "  box-sizing: border-box;",
      "  max-height: 0px;",
      "  overflow: hidden;",
      "  opacity: 0;",
      "  transform: scale(0.98);",
      "  pointer-events: none;",
      `  transition: max-height ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms ease;`,
      "}",
      `#${TAG_ID} div {`,
      "  transition: inherit;",
      "}",
      `#${TAG_ID} .gemini-dialog-title {`,
      "  font-weight: 600;",
      "  font-size: 13px;",
      "  line-height: 1.4;",
      "}",
      `#${TAG_ID} .gemini-dialog-options {`,
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 6px;",
      "}",
      `#${TAG_ID} .gemini-dialog-options button {`,
      "  margin: 0;",
      "  padding: 8px 10px;",
      "  font-size: 12px;",
      "  line-height: 1.4;",
      "  border-radius: 6px;",
      "  border: 1px solid #ccc;",
      "  background: #d9d9d9;",
      "  cursor: pointer;",
      "  text-align: left;",
      "  white-space: normal;",
      "  word-break: break-word;",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "}",
      `#${TAG_ID} .gemini-dialog-options button:hover { filter: brightness(0.98); }`,
      `#${TAG_ID} .gemini-dialog-options button:active { filter: brightness(0.95); }`
    ].join("\n");

    (document.head || document.documentElement).appendChild(style);
  }

  function attachSelectionListeners() {
    document.addEventListener("mouseup", scheduleSelectionCheck);
    document.addEventListener("keyup", function (event) {
      if (shouldHandleKey(event)) {
        scheduleSelectionCheck(event);
      }
    });
  }

  function attachViewportListeners() {
    const handleViewportChange = function () {
      if (!isTagVisible()) return;
      window.requestAnimationFrame(function () {
        repositionTag();
      });
    };

    window.addEventListener("scroll", handleViewportChange, { passive: true });
    window.addEventListener("resize", handleViewportChange);
  }

  function scheduleSelectionCheck(event) {
    window.setTimeout(function () {
      processSelection(event);
    }, 0);
  }

  function shouldHandleKey(event) {
    if (KEYBOARD_SELECTION_KEYS.has(event.key)) return true;
    return event.key === SELECT_ALL_KEY && (event.ctrlKey || event.metaKey);
  }

  function processSelection(triggerEvent) {
    const selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed) {
      hideTag();
      return;
    }

    const selectedText = selection.toString().trim();
    if (selectedText.length < MIN_SELECTION_LENGTH) {
      hideTag();
      return;
    }

    const { prompt, truncated } = buildPrompt(selectedText);
    const range = getFirstRange(selection);
    if (!range) {
      hideTag();
      return;
    }

    const rect = range.getBoundingClientRect();
    const position = resolvePosition(rect, triggerEvent);

    const selectionKey = buildSelectionKey(prompt, truncated);
    const tag = tagElement;
    const sameSelection = Boolean(tag && tag.dataset.selectionSignature === selectionKey);
    const hasFinalSuggestions = sameSelection && tag.dataset.hasSuggestions === "true";
    const isLoading = sameSelection && tag.dataset.isLoading === "true";
    const existingOptions = sameSelection ? collectOptionTemplates(tag) : null;
    const optionsToUse =
      existingOptions && existingOptions.length ? existingOptions : LOADING_PROMPTS;

    showTag(prompt, position, selectionKey, optionsToUse, {
      isLoading: !hasFinalSuggestions,
      hasSuggestions: hasFinalSuggestions,
      truncatedSelection: truncated,
      originalSelection: selectedText,
      sourceUrl: window.location.href || ""
    });

    if (!hasFinalSuggestions && !isLoading) {
      requestSuggestions(truncated, prompt, selectionKey);
    }
  }

  function buildPrompt(selectedText) {
    const truncated = truncateText(selectedText, state.maxLen);
    return {
      prompt: (state.prefix + truncated).trim(),
      truncated
    };
  }

  function getFirstRange(selection) {
    if (!selection.rangeCount) return null;
    try {
      return selection.getRangeAt(0);
    } catch (err) {
      return null;
    }
  }

  function resolvePosition(rect, triggerEvent) {
    if (rect && (rect.width > 0 || rect.height > 0)) {
      return {
        clientX: rect.left,
        clientY: rect.bottom + POSITION_OFFSET
      };
    }

    if (triggerEvent && typeof triggerEvent.clientX === "number" && typeof triggerEvent.clientY === "number") {
      return {
        clientX: triggerEvent.clientX,
        clientY: triggerEvent.clientY + POSITION_OFFSET
      };
    }

    return {
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2
    };
  }

  function buildSelectionKey(prompt, truncatedText) {
    return `${prompt}|${truncatedText}`;
  }

  function collectOptionTemplates(container) {
    if (!container) return [];
    const buttons = container._optionButtons || [];
    const limit = Math.min(state.suggestionCount, MAX_SUGGESTION_COUNT);
    const options = [];
    for (let i = 0; i < limit; i += 1) {
      options.push(buttons[i]?.dataset?.promptTemplate || "");
    }
    return options.some(Boolean) ? options : [];
  }

  function showTag(
    prompt,
    position,
    selectionKey,
    options,
    {
      isLoading = false,
      hasSuggestions = false,
      truncatedSelection = "",
      originalSelection = "",
      sourceUrl = ""
    } = {}
  ) {
    const tag = tagElement || ensureTagElement();
    tagElement = tag;
    const resolvedOptions =
      options && options.length ? options : (hasSuggestions ? FALLBACK_PROMPTS : LOADING_PROMPTS);
    populateOptions(tag, resolvedOptions, prompt, {
      isLoading,
      markAsFinal: hasSuggestions,
      isFallback: resolvedOptions === FALLBACK_PROMPTS
    });
    tag.dataset.selectionSignature = selectionKey || "";
    tag.dataset.selectionContext = truncatedSelection || "";
    tag.dataset.selectionRaw = originalSelection || truncatedSelection || "";
    tag.dataset.selectionSource = sourceUrl || window.location.href || "";
    ensureTagVisible(tag);

    const pageX = position.clientX + window.scrollX;
    const pageY = position.clientY + window.scrollY;
    const width = tag.offsetWidth || DEFAULT_DIALOG_WIDTH;
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const minLeft = window.scrollX;
    const maxLeft = minLeft + viewportWidth - width - POSITION_OFFSET;
    const clampedLeft = Math.max(Math.min(pageX, maxLeft), minLeft);

    tag.style.left = `${clampedLeft}px`;
    tag.style.top = `${pageY}px`;
  }

  function populateOptions(
    container,
    options,
    basePrompt,
    { isLoading = false, markAsFinal = false, isFallback = false } = {}
  ) {
    container.dataset.selectionPrompt = basePrompt;
    container.dataset.hasSuggestions = markAsFinal ? "true" : "false";
    container.dataset.isLoading = isLoading ? "true" : "false";
    container.dataset.isFallback = isFallback ? "true" : "false";
    const buttons = container._optionButtons || [];
    const limit = Math.min(state.suggestionCount, MAX_SUGGESTION_COUNT);
    buttons.forEach(function (button, index) {
      if (index < limit) {
        const label = options[index] || "";
        button.textContent = label;
        button.dataset.promptTemplate = label;
        button.disabled = isLoading || !label;
        button.style.display = label ? "block" : "none";
      } else {
        button.textContent = "";
        button.dataset.promptTemplate = "";
        button.disabled = true;
        button.style.display = "none";
      }
    });
    updateTagSize(container);
  }

  function ensureTagVisible(tag) {
    if (!tag) return;
    if (tag._hideTimer) {
      window.clearTimeout(tag._hideTimer);
      tag._hideTimer = null;
    }
    const wasHidden = tag.style.display === "none";
    tag.style.display = "flex";
    if (!wasHidden && tag.style.opacity === "1") {
      tag.style.pointerEvents = "auto";
      updateTagSize(tag);
      return;
    }
    window.requestAnimationFrame(function () {
      tag.style.pointerEvents = "auto";
      tag.style.opacity = "1";
      tag.style.transform = "scale(1)";
      updateTagSize(tag);
    });
  }

  function updateTagSize(tag) {
    if (!tag || tag.style.display === "none") return;
    const prevMax = tag.style.maxHeight && tag.style.maxHeight !== "none" ? tag.style.maxHeight : "0px";
    tag.style.maxHeight = "none";
    const targetHeight = tag.scrollHeight;
    const targetValue = `${targetHeight}px`;
    tag.style.maxHeight = prevMax;
    // Force reflow to ensure the transition triggers
    void tag.offsetHeight;
    tag.style.maxHeight = targetValue;
  }

  function animateTagClose(tag) {
    if (!tag) return;
    if (tag._hideTimer) {
      window.clearTimeout(tag._hideTimer);
      tag._hideTimer = null;
    }
    if (tag.style.display === "none") return;
    tag.style.pointerEvents = "none";
    updateTagSize(tag);
    void tag.offsetHeight;
    tag.style.opacity = "0";
    tag.style.transform = "scale(0.98)";
    tag.style.maxHeight = "0px";
    tag._hideTimer = window.setTimeout(function () {
      tag.style.display = "none";
      tag._hideTimer = null;
    }, TRANSITION_MS);
  }

  function requestSuggestions(selectedText, basePrompt, selectionKey) {
    const container = tagElement;
    if (!container) return;

    if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      container.dataset.suggestionRequestId = "";
      populateOptions(container, FALLBACK_PROMPTS, basePrompt, { markAsFinal: true, isFallback: true });
      return;
    }

    const requestId = ++suggestionRequestCounter;
    container.dataset.suggestionRequestId = String(requestId);
    scheduleSuggestionTimeout(requestId, basePrompt);

    try {
      chrome.runtime.sendMessage(
        {
          type: "SUGGEST_PROMPTS",
          text: selectedText,
          tone: state.tone,
          n: Math.min(state.suggestionCount, MAX_SUGGESTION_COUNT)
        },
        function (response) {
          const runtimeError = chrome.runtime.lastError;
          const tag = tagElement;
          if (!tag) return;
          if (tag.dataset.selectionSignature !== selectionKey) return;
          if (tag.dataset.suggestionRequestId !== String(requestId)) return;
          clearSuggestionTimeout(tag);

          if (runtimeError) {
            populateOptions(tag, FALLBACK_PROMPTS, basePrompt, { markAsFinal: true, isFallback: true });
            tag.dataset.suggestionRequestId = "";
            return;
          }

          const prompts = Array.isArray(response?.prompts)
            ? response.prompts.map(function (p) {
                return String(p || "").trim();
              }).filter(Boolean)
            : [];

          if (!response || response.ok !== true || !prompts.length) {
            populateOptions(tag, FALLBACK_PROMPTS, basePrompt, { markAsFinal: true, isFallback: true });
            tag.dataset.suggestionRequestId = "";
            return;
          }

          const limit = Math.min(state.suggestionCount, MAX_SUGGESTION_COUNT);
          const limited = prompts.slice(0, limit);
          populateOptions(tag, limited, basePrompt, { markAsFinal: true });
          tag.dataset.suggestionRequestId = "";
        }
      );
    } catch (err) {
      clearSuggestionTimeout(container);
      populateOptions(container, FALLBACK_PROMPTS, basePrompt, { markAsFinal: true, isFallback: true });
      container.dataset.suggestionRequestId = "";
    }
  }

  function repositionTag() {
    processSelection(null);
  }

  function hideTag() {
    if (!tagElement) return;
    animateTagClose(tagElement);
    clearSuggestionTimeout(tagElement);
    tagElement.dataset.selectionPrompt = "";
    tagElement.dataset.selectionSignature = "";
    tagElement.dataset.hasSuggestions = "false";
    tagElement.dataset.isLoading = "false";
    tagElement.dataset.selectionContext = "";
    tagElement.dataset.selectionRaw = "";
    tagElement.dataset.selectionSource = "";
    tagElement.dataset.isFallback = "false";
    tagElement.dataset.suggestionRequestId = "";
  }

  function isTagVisible() {
    return Boolean(tagElement && tagElement.style.display !== "none");
  }

  function handleOptionClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const container = tagElement;
    if (!container) return;

    if (container.dataset.hasSuggestions !== "true") return;
    if (container.dataset.isFallback === "true") return;

    clearSuggestionTimeout(container);
    const basePrompt = container.dataset.selectionPrompt || "";
    const optionTemplate = (button.dataset.promptTemplate || "").trim();
    if (!optionTemplate) return;

    const contextRaw = container.dataset.selectionRaw || "";
    const contextTruncated = container.dataset.selectionContext || "";
    const pageUrl = container.dataset.selectionSource || window.location.href || "";
    const pageTitle = document.title || "";

    const payload = {
      kind: "run-selection-prompt",
      suggestion: optionTemplate,
      basePrompt,
      contextText: contextRaw,
      truncatedContext: contextTruncated,
      pageUrl,
      pageTitle,
      createdAt: Date.now()
    };

    try {
      chrome.runtime?.sendMessage?.(
        {
          type: "OPEN_POPUP_WINDOW",
          payload
        },
        () => {
          void chrome.runtime?.lastError;
        }
      );
    } catch (err) {
      console.warn("Failed to request popup window:", err);
    }

    hideTag();
  }

  function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    if (maxLength <= 0) return "";
    const sliceLength = Math.max(maxLength - ELLIPSIS.length, 0);
    return text.slice(0, sliceLength) + ELLIPSIS;
  }

  function scheduleSuggestionTimeout(requestId, basePrompt) {
    const container = tagElement;
    if (!container) return;
    clearSuggestionTimeout(container);
    const timeoutId = window.setTimeout(function () {
      if (!tagElement) return;
      if (tagElement.dataset.suggestionRequestId !== String(requestId)) return;
      populateOptions(tagElement, FALLBACK_PROMPTS, basePrompt, { markAsFinal: true, isFallback: true });
      tagElement.dataset.suggestionRequestId = "";
      tagElement.dataset.isLoading = "false";
      tagElement.dataset.suggestionTimeoutId = "";
    }, 8000);
    container.dataset.suggestionTimeoutId = String(timeoutId);
  }

  function clearSuggestionTimeout(container) {
    if (!container) return;
    const timeoutId = container.dataset.suggestionTimeoutId;
    if (!timeoutId) return;
    window.clearTimeout(Number(timeoutId));
    container.dataset.suggestionTimeoutId = "";
  }

  function registerStorageListener() {
    if (storageListenerRegistered) return;
    const storage = getStorageArea();
    if (!storage) return;
    storageListenerRegistered = true;

    try {
      storage.get(
        [SETTINGS_KEYS.SUGGESTION_COUNT, SETTINGS_KEYS.SUGGESTION_TONE],
        function (cfg) {
          if (chrome.runtime?.lastError) return;
          applyDynamicSettings(cfg || {});
        }
      );
    } catch {}

    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== "sync" && areaName !== "local") return;
      const delta = {};
      if (Object.prototype.hasOwnProperty.call(changes, SETTINGS_KEYS.SUGGESTION_COUNT)) {
        delta[SETTINGS_KEYS.SUGGESTION_COUNT] = changes[SETTINGS_KEYS.SUGGESTION_COUNT].newValue;
      }
      if (Object.prototype.hasOwnProperty.call(changes, SETTINGS_KEYS.SUGGESTION_TONE)) {
        delta[SETTINGS_KEYS.SUGGESTION_TONE] = changes[SETTINGS_KEYS.SUGGESTION_TONE].newValue;
      }
      applyDynamicSettings(delta);
    });
  }

  function applyDynamicSettings(cfg) {
    if (!cfg) return;
    if (cfg[SETTINGS_KEYS.SUGGESTION_COUNT] !== undefined) {
      state.suggestionCount = clampSuggestionCount(cfg[SETTINGS_KEYS.SUGGESTION_COUNT]);
      updateButtonLimit();
    }
    if (cfg.hasOwnProperty(SETTINGS_KEYS.SUGGESTION_TONE)) {
      const tone = String(cfg[SETTINGS_KEYS.SUGGESTION_TONE] ?? "").trim();
      state.tone = VALID_TONES.has(tone) ? tone : DEFAULT_TONE;
    }
  }

  function clampSuggestionCount(value) {
    const num = Number(value);
    if (Number.isNaN(num)) return DEFAULT_SUGGESTION_COUNT;
    return Math.min(Math.max(Math.round(num), 1), MAX_SUGGESTION_COUNT);
  }

  function updateButtonLimit() {
    if (!tagElement || !tagElement._optionButtons) return;
    const limit = Math.min(state.suggestionCount, MAX_SUGGESTION_COUNT);
    tagElement._optionButtons.forEach(function (button, index) {
      if (index < limit) {
        if (button.dataset.promptTemplate) {
          button.style.display = "block";
          button.disabled = false;
        }
      } else {
        button.style.display = "none";
        button.disabled = true;
      }
    });
  }

})();
