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
  const DIALOG_TITLE = "Suggested prompts:";
  const SAMPLE_PROMPTS = ["Sample prompt 1", "Sample prompt 2", "Sample prompt 3"];

  const state = {
    maxLen: DEFAULT_MAX_LEN,
    baseUrl: "https://gemini.google.com/app",
    prefix: "Explain this:\n\n"
  };

  let tagElement = null;

  init();

  function init() {
    if (canUseSyncStorage()) {
      loadSettings();
      return;
    }
    setup();
  }

  function canUseSyncStorage() {
    return (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.sync &&
      typeof chrome.storage.sync.get === "function"
    );
  }

  function loadSettings() {
    try {
      chrome.storage.sync.get(["maxLen", "baseUrl", "prefix"], function (cfg) {
        applyConfig(cfg);
        setup();
      });
    } catch (err) {
      setup();
    }
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (typeof cfg.maxLen === "number") state.maxLen = cfg.maxLen;
    if (typeof cfg.baseUrl === "string" && cfg.baseUrl) state.baseUrl = cfg.baseUrl;
    if (typeof cfg.prefix === "string") state.prefix = cfg.prefix;
  }

  function setup() {
    tagElement = ensureTagElement();
    injectTagStyles();
    attachSelectionListeners();
    attachViewportListeners();
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

    const optionButtons = SAMPLE_PROMPTS.map(function (_, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.optionIndex = String(index);
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
      "  border-radius: 8px;",
      "  padding: 12px;",
      "  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;",
      "  color: #333;",
      "  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);",
      "  user-select: none;",
      "  max-width: 400px;",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 8px;",
      "  box-sizing: border-box;",
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

    const prompt = buildPrompt(selectedText);
    const range = getFirstRange(selection);
    if (!range) {
      hideTag();
      return;
    }

    const rect = range.getBoundingClientRect();
    const position = resolvePosition(rect, triggerEvent);

    showTag(prompt, position);
  }

  function buildPrompt(selectedText) {
    const truncated = truncateText(selectedText, state.maxLen);
    return (state.prefix + truncated).trim();
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

  function showTag(prompt, position) {
    const tag = tagElement || ensureTagElement();
    tagElement = tag;
    populateOptions(tag, SAMPLE_PROMPTS, prompt);
    tag.style.display = "flex";

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

  function populateOptions(container, options, basePrompt) {
    container.dataset.selectionPrompt = basePrompt;
    const buttons = container._optionButtons || [];
    buttons.forEach(function (button, index) {
      const label = options[index] || "";
      button.textContent = label;
      button.dataset.promptTemplate = label;
      button.disabled = !label;
      button.style.display = label ? "block" : "none";
    });
  }

  function repositionTag() {
    processSelection(null);
  }

  function hideTag() {
    if (!tagElement) return;
    tagElement.style.display = "none";
    tagElement.dataset.selectionPrompt = "";
  }

  function isTagVisible() {
    return Boolean(tagElement && tagElement.style.display !== "none");
  }

  function copyToClipboard(text) {
    if (!text) return;
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      return;
    }

    try {
      const write = navigator.clipboard.writeText(text);
      if (write && typeof write.catch === "function") {
        write.catch(function () {});
      }
    } catch (err) {
      // noop
    }
  }

  function openGemini(prompt) {
    const url = `${state.baseUrl}?query=${encodeURIComponent(prompt)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleOptionClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const container = tagElement;
    if (!container) return;

    const basePrompt = container.dataset.selectionPrompt || "";
    const optionTemplate = button.dataset.promptTemplate || "";
    const fullPrompt = buildOptionPrompt(optionTemplate, basePrompt);

    copyToClipboard(fullPrompt);
    openGemini(fullPrompt);
  }

  function buildOptionPrompt(optionTemplate, basePrompt) {
    const trimmedTemplate = optionTemplate.trim();
    const trimmedBase = basePrompt.trim();
    if (trimmedTemplate && trimmedBase) {
      return `${trimmedTemplate}\n\n${trimmedBase}`;
    }
    if (trimmedTemplate) return trimmedTemplate;
    return trimmedBase;
  }

  function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    if (maxLength <= 0) return "";
    const sliceLength = Math.max(maxLength - ELLIPSIS.length, 0);
    return text.slice(0, sliceLength) + ELLIPSIS;
  }
})();
