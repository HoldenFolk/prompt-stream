(function () {
  // Parse ?query=... from the URL
  var params = new URLSearchParams(window.location.search);
  var incoming = params.get("query") || "";
  if (!incoming) return;

  // helper: try to place text into an element
  function tryFill(el, text) {
    if (!el) return false;

    // textarea / input-like
    if ("value" in el) {
      el.focus();
      el.value = text;

      // fire input event so frameworks notice
      var ev = new Event("input", { bubbles: true });
      el.dispatchEvent(ev);
      return true;
    }

    // contenteditable div
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") {
      el.focus();
      el.textContent = text;

      var ev2 = new Event("input", { bubbles: true });
      el.dispatchEvent(ev2);
      return true;
    }

    return false;
  }

  function attemptInjection() {
    // Heuristics: try obvious selectors
    // 1. textarea
    var t1 = document.querySelector("textarea");
    if (tryFill(t1, incoming)) return true;

    // 2. contenteditable divs
    var editables = document.querySelectorAll("[contenteditable='true']");
    for (var i = 0; i < editables.length; i++) {
      if (tryFill(editables[i], incoming)) return true;
    }

    // 3. input[type=text] fallback
    var t2 = document.querySelector("input[type='text'], input[aria-label='Message'], input[role='textbox']");
    if (tryFill(t2, incoming)) return true;

    return false;
  }

  // Try now, then again shortly after load to catch late-rendered UIs
  if (!attemptInjection()) {
    setTimeout(attemptInjection, 400);
    setTimeout(attemptInjection, 800);
  }
})();
