(function () {
  var TAG_ID = "gemini-selection-tag";
  var DIALOG_ID = "gemini-prompts-dialog";
  var DEFAULT_MAX_LEN = 500;

  var state = {
    maxLen: DEFAULT_MAX_LEN,
    baseUrl: "https://gemini.google.com/app",
    prefix: "Explain this:\n\n"
  };

  // load settings
  try {
    chrome.storage.sync.get(["maxLen", "baseUrl", "prefix"], function (cfg) {
      if (cfg && typeof cfg.maxLen === "number") state.maxLen = cfg.maxLen;
      if (cfg && typeof cfg.baseUrl === "string" && cfg.baseUrl) state.baseUrl = cfg.baseUrl;
      if (cfg && typeof cfg.prefix === "string") state.prefix = cfg.prefix;
      setup();
    });
  } catch (e) {
    setup();
  }

  function setup() {
    injectStyles();
    injectDialogStyles();
    ensureTagElement();
    ensureDialogElement();
    attachSelectionListener();
    attachScrollAndResizeHide();
  }

  function ensureTagElement() {
    if (document.getElementById(TAG_ID)) return;

    var el = document.createElement("div");
    el.id = TAG_ID;
    el.style.display = "none";
    el.setAttribute("data-gemini-prompt", "");

    el.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();

      var prompt = el.getAttribute("data-gemini-prompt") || "";
      if (!prompt) return;

      // Clipboard fallback
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(prompt);
        }
      } catch (err) {}

      // Open Gemini with ?query=<encoded prompt>
      var url = state.baseUrl + "?query=" + encodeURIComponent(prompt);
      window.open(url, "_blank", "noopener,noreferrer");
    });

    document.documentElement.appendChild(el);
  }

  // 
  function ensureDialogElement() {
    if (document.getElementById(DIALOG_ID)) return;

    var el = document.createElement("div");
    el.id = DIALOG_ID;
    el.style.display = "none";
    // el.setAttribute("data-gemini-prompt", "");

    // el.addEventListener("click", function (ev) {
    //   ev.preventDefault();
    //   ev.stopPropagation();

    //   var prompt = el.getAttribute("data-gemini-prompt") || "";
    //   if (!prompt) return;

    //   // Clipboard fallback
    //   try {
    //     if (navigator.clipboard && navigator.clipboard.writeText) {
    //       navigator.clipboard.writeText(prompt);
    //     }
    //   } catch (err) {}

    //   // Open Gemini with ?query=<encoded prompt>
    //   var url = state.baseUrl + "?query=" + encodeURIComponent(prompt);
    //   window.open(url, "_blank", "noopener,noreferrer");
    // });

    document.documentElement.appendChild(el);
  }

  function attachSelectionListener() {
    document.addEventListener("mouseup", function (e) {
      setTimeout(function () {
        handleSelection(e);
      }, 0);
    });

    document.addEventListener("keyup", function (e) {
      // support keyboard-based selections too
      if (
        e.key === "Shift" ||
        e.key === "ArrowLeft" || e.key === "ArrowRight" ||
        e.key === "ArrowUp"   || e.key === "ArrowDown" ||
        (e.key === "a" && (e.ctrlKey || e.metaKey)) // ctrl+a / cmd+a
      ) {
        handleSelection(e);
      }
    });
  }

  function attachScrollAndResizeHide() {
    window.addEventListener("scroll", hideTag, { passive: true });
    window.addEventListener("resize", hideTag);
  }

  function handleSelection(evt) {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed) {
        // hideTag();
        hideDialog
        return;
    }

    var text = sel.toString().trim();
    if (!text || text.length < 5) {
      // hideTag();
      hideDialog();
      return;
    }

    var truncated = truncate(text, state.maxLen);
    var prompt = (state.prefix + truncated).trim();

    var range;
    try {
      range = sel.getRangeAt(0);
    } catch (err) {
      // hideTag();
      hideDialog();
      return;
    }

    var rect = range.getBoundingClientRect();
    if (!rect || (rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0)) {
      var fallbackX = (evt && evt.clientX) ? evt.clientX : (window.innerWidth / 2);
      var fallbackY = (evt && evt.clientY) ? evt.clientY : (window.innerHeight / 2);
      // showTagAt(prompt, fallbackX, fallbackY);
      showDialogAt(prompt, fallbackX, fallbackY);
      return;
    }

    var bubbleX = rect.left + (rect.width / 2);
    var bubbleY = rect.top - 8;
    if (bubbleY < 0) {
      bubbleY = rect.bottom + 8;
    }

    // showTagAt(prompt, bubbleX, bubbleY);
    showDialogAt(prompt, bubbleX, bubbleY);
  }

  // Show the "analyze" chip at given client coordinates
  function showTagAt(prompt, clientX, clientY) {
    var tag = document.getElementById(TAG_ID);
    if (!tag) return;

    tag.setAttribute("data-gemini-prompt", prompt);
    tag.textContent = "✨Analyze";
    tag.style.display = "block";

    var pageX = clientX + window.scrollX;
    var pageY = clientY + window.scrollY;

    // rough horizontal centering
    var bubbleWidth = tag.offsetWidth || 140;
    var leftPx = pageX - bubbleWidth / 2;

    tag.style.left = leftPx + "px";
    tag.style.top = pageY + "px";
  }

  function showDialogAt(prompt, clientX, clientY) {
    var dialog = document.getElementById(DIALOG_ID);
    if (!dialog) return;

    // clear any previous content
    dialog.innerHTML = "";

    // title
    var title = document.createElement("div");
    title.textContent = "Select a prompt option";
    title.style.fontWeight = "600";
    title.style.marginTop = "4px";
    title.style.marginBottom = "6px";
    dialog.appendChild(title);

    // buttons
    var options = ["Summarize", "Rewrite", "Question"];
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.textContent = opt;
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();

        // build the full prompt for this option
        var fullPrompt = (opt + ":\n\n" + prompt).trim();

        // clipboard fallback
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(fullPrompt);
          }
        } catch (err) {}

        // open Gemini with ?query=<encoded prompt>
        var url = state.baseUrl + "?query=" + encodeURIComponent(fullPrompt);
        window.open(url, "_blank", "noopener,noreferrer");

        // hide dialog after action
        dialog.style.display = "none";
      });
      dialog.appendChild(btn);
    });

    // position and show
    dialog.style.display = "flex";
    dialog.style.flexDirection = "column";
    dialog.style.alignItems = "start";  
    

    var pageX = clientX + window.scrollX;
    var pageY = clientY + window.scrollY;

    // center horizontally roughly
    var dialogWidth = dialog.offsetWidth || 200;
    var leftPx = pageX - dialogWidth / 2;
    dialog.style.left = leftPx + "px";
    dialog.style.top = pageY + "px";
  }

  function hideTag() {
    var tag = document.getElementById(TAG_ID);
    if (!tag) return;
    tag.style.display = "none";
    tag.setAttribute("data-gemini-prompt", "");
  }

  function hideDialog() {
    var dialog = document.getElementById(DIALOG_ID);
    if (!dialog) return;
    dialog.style.display = "none";
  }

  function truncate(str, n) {
    if (str.length <= n) return str;
    return str.slice(0, n - 1) + "…";
  }

  function injectStyles() {
    if (document.getElementById("gemini-selection-style")) return;
    var style = document.createElement("style");
    style.id = "gemini-selection-style";
    style.textContent =
      "#" + TAG_ID + " {" +
      "  position: absolute;" +
      "  z-index: 2147483647;" +
      "  background: #f2f2f2;" +
      "  border: 1px solid #d9d9d9;" +
      "  border-radius: 8px;" +
      "  padding: 6px 10px;" +
      "  font-size: 12px;" +
      "  line-height: 1.3;" +
      "  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;" +
      "  color: #333;" +
      "  box-shadow: 0 4px 12px rgba(0,0,0,0.12);" +
      "  cursor: pointer;" +
      "  user-select: none;" +
      "  white-space: nowrap;" +
      "}" +
      "#" + TAG_ID + ":hover { filter: brightness(0.98); }" +
      "#" + TAG_ID + ":active { filter: brightness(0.95); }";
    (document.head || document.documentElement).appendChild(style);
  }

  function injectDialogStyles() {
    var style = document.createElement("style");
    style.id = "prompts-dialog-style";
    style.textContent = 
      "#" + DIALOG_ID + " {" +
      "  position: absolute;" +
      "  z-index: 2147483647;" +
      "  background: #f2f2f2;" +
      "  border: 1px solid #d9d9d9;" +
      "  border-radius: 8px;" +
      "  padding: 6px 10px;" +
      "  font-size: 12px;" +
      "  line-height: 1.3;" +
      "  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;" +
      "  color: #333;" +
      "  box-shadow: 0 4px 12px rgba(0,0,0,0.12);" +
      "  user-select: none;" +
      "  white-space: nowrap;" +
      "}" +
      "#" + DIALOG_ID + " button {" +
      "  margin: 2px 0;" +
      "  padding: 6px 12px;" +
      "  font-size: 12px;" +
      "  border-radius: 6px;" +
      "  border: 1px solid #ccc;" +
      "  background: #d9d9d9ff;" +
      "  cursor: pointer;" +
      "  width: 100%;" +
      "}" +
      "#" + DIALOG_ID + " button:hover { filter: brightness(0.98); }" +
      "#" + DIALOG_ID + " button:active { filter: brightness(0.95); }";
    (document.head || document.documentElement).appendChild(style);
  }
})();
