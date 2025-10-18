// === Tunables ===
const MIN_VIEWPORT_WIDTH_RATIO = 0.3; // 30% of viewport width
const MAX_PROMPT_LENGTH = 4000;
const MIN_TEXT_LENGTH = 100;          // quick prefilter on visible text length
const BUBBLE_CLASS = "gemini-prompt-bubble";
const CONTAINER_CLASS = "gemini-prompt-container";
const MARK_ATTR = "data-gemini-bubbled";  // marks target divs we've handled
const OUR_ATTR = "data-gemini-container"; // marks our inserted container

// requestIdleCallback fallback
const ric = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 50 }), 1));

// Tracks
const processed = new WeakSet(); // finished: bubble inserted or deemed ineligible
const observed  = new WeakSet(); // observed by IO (not yet processed)
const candidateQueue = new Set();

// Give each target DIV a stable ephemeral id (not DOM attribute unless needed)
let _uidSeq = 1;
const uidMap = new WeakMap();
const getUid = (el) => {
  let id = uidMap.get(el);
  if (!id) { id = String(_uidSeq++); uidMap.set(el, id); }
  return id;
};

// Single delegated click listener
document.addEventListener("click", (e) => {
  const bubble = e.target && e.target.nodeType === 1
    ? (e.target.classList && e.target.classList.contains(BUBBLE_CLASS) ? e.target
       : (e.target.parentElement && e.target.parentElement.classList && e.target.parentElement.classList.contains(BUBBLE_CLASS) ? e.target.parentElement
       : null))
    : null;
  if (!bubble) return;
  e.preventDefault(); e.stopPropagation();
  const prompt = bubble.dataset.prompt || bubble.textContent || "";
  if (!prompt) return;
  chrome.runtime.sendMessage({ type: "OPEN_GEMINI", prompt });
}, { passive: true });

// Don’t react to our own insertions
function isOurNode(node) {
  return node instanceof Element && (node.classList.contains(CONTAINER_CLASS) || node.hasAttribute(OUR_ATTR));
}

// Visible-text extractor (skips <style>/<script> and hidden nodes)
function cleanText(el) {
  return (el.innerText || "").replace(/\s+/g, " ").trim();
}

// At least one visible <p> with non-empty text?
function hasVisibleParagraph(rootEl) {
  const ps = rootEl.querySelectorAll("p");
  for (let i = 0; i < ps.length; i++) {
    const t = (ps[i].innerText || "").replace(/\s+/g, " ").trim();
    if (t.length > 0) return true;
  }
  return false;
}

/**
 * Robust ancestor check WITHOUT .closest():
 * - Walks parentElement chain
 * - If we hit a shadow root, jump to its host
 * - Follows assignedSlot to cross slot -> host
 * - Considers <nav> and elements with role="navigation"
 */
function isInNav(el) {
  let node = el;
  while (node) {
    if (node.nodeType === 1) {
      const tag = node.tagName;
      if (tag === "NAV") return true;
      const role = node.getAttribute && node.getAttribute("role");
      if (role === "navigation") return true;
    }
    if (node.assignedSlot) { node = node.assignedSlot; continue; }
    if (node.parentElement) { node = node.parentElement; continue; }
    const root = node.getRootNode && node.getRootNode();
    if (root && root.host) { node = root.host; continue; }
    break;
  }
  return false;
}

// Heuristic: clickable?
function isClickable(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "A" || tag === "BUTTON" || tag === "SUMMARY") return true;
  const role = el.getAttribute && el.getAttribute("role");
  if (role === "button" || role === "link" || role === "tab") return true;
  const tabIndex = el.getAttribute && el.getAttribute("tabindex");
  if (tabIndex && parseInt(tabIndex, 10) >= 0) return true;
  const style = window.getComputedStyle(el);
  if (style.cursor === "pointer") return true;
  if (style.pointerEvents === "none") return false;
  if (typeof el.onclick === "function") return true;
  // ancestor interactive check without closest()
  let p = el.parentElement;
  while (p) {
    const pr = p.getAttribute && p.getAttribute("role");
    if (p.tagName === "A" || p.tagName === "BUTTON" || pr === "button" || pr === "link") return true;
    p = p.parentElement;
  }
  return false;
}

/**
 * NEW: sentence heuristic
 * A div is eligible only if its text contains at least one sentence
 * that ENDS WITH "." and has > 5 words (i.e., 6+ words).
 */
function hasSentenceWithMoreThanFiveWords(text) {
  if (!text) return false;
  // Extract sentences that end with a literal dot.
  // This finds the shortest runs of non-dot chars ending in a dot.
  // e.g., "This is a sentence. Short." -> ["This is a sentence.", "Short."]
  const sentences = text.match(/[^.]*\./g);
  if (!sentences) return false;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();
    if (!s.endsWith(".")) continue;
    // Count words (split on whitespace)
    const words = s.slice(0, -1).trim().split(/\s+/).filter(Boolean); // remove trailing "."
    if (words.length >= 6) return true;
  }
  return false;
}

function isEligibleDiv(div) {
  if (!(div instanceof HTMLElement)) return false;
  if (processed.has(div)) return false;
  if (div.hasAttribute(MARK_ATTR)) return false;     // already bubbled (by us)
  if (div.isContentEditable) return false;
  if (isClickable(div)) return false;
  if (isInNav(div)) return false;

  // Require at least one visible <p> inside (kept from your version)
  if (!hasVisibleParagraph(div)) return false;

  // Clean visible text once for the rest of the checks
  const text = cleanText(div);

  // Quick length prefilter
  if (text.length < MIN_TEXT_LENGTH) return false;

  // ✅ NEW: must contain a dot-terminated sentence with > 5 words
  if (!hasSentenceWithMoreThanFiveWords(text)) return false;

  return true;
}

function enqueue(div) {
  if (!isEligibleDiv(div)) return;
  candidateQueue.add(div);
  scheduleObserve();
}

let observeScheduled = false;
function scheduleObserve() {
  if (observeScheduled) return;
  observeScheduled = true;
  ric(() => {
    observeScheduled = false;
    const BATCH = 300;
    const arr = Array.from(candidateQueue);
    candidateQueue.clear();
    for (let i = 0; i < arr.length; i += BATCH) {
      const slice = arr.slice(i, i + BATCH);
      requestAnimationFrame(() => {
        for (const el of slice) {
          if (!processed.has(el) && !observed.has(el)) {
            io.observe(el);
            observed.add(el);
          }
        }
      });
    }
  });
}

// Ensure exactly one bubble per target DIV
function ensureSingleBubble(targetDiv, prompt) {
  const targetId = getUid(targetDiv);

  // If previousElementSibling is our container for the same target, reuse/update it.
  const prev = targetDiv.previousElementSibling;
  if (prev && prev.hasAttribute && prev.hasAttribute(OUR_ATTR) && prev.getAttribute("data-target-id") === targetId) {
    const bubble = prev.querySelector(`.${BUBBLE_CLASS}`);
    if (bubble) {
      if (bubble.dataset.prompt !== prompt) {
        bubble.dataset.prompt = prompt;
        const snippet = prompt.length > 140 ? prompt.slice(0, 140) + "…" : prompt;
        bubble.textContent = snippet;
      }
    }
    return true; // already present
  }

  // If there’s some other our-container (due to earlier duplication), remove extras
  let sib = targetDiv.previousElementSibling;
  while (sib && sib.hasAttribute && sib.hasAttribute(OUR_ATTR)) {
    const toRemove = sib;
    sib = sib.previousElementSibling;
    toRemove.remove();
  }

  // Create new container+bubble
  const container = document.createElement("div");
  container.className = CONTAINER_CLASS;
  container.setAttribute(OUR_ATTR, "1");
  container.setAttribute("data-target-id", targetId);

  const bubble = document.createElement("div");
  bubble.className = BUBBLE_CLASS;

  bubble.dataset.prompt = prompt;
  const snippet = prompt.length > 140 ? prompt.slice(0, 140) + "…" : prompt;
  bubble.textContent = snippet;
  bubble.title = "Open in Gemini";

  container.appendChild(bubble);
  if (targetDiv.parentNode) {
    targetDiv.parentNode.insertBefore(container, targetDiv);
    targetDiv.setAttribute(MARK_ATTR, "1");
  }
  return false; // new insert
}

const io = new IntersectionObserver((entries) => {
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0) || 1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const el = entry.target;
    if (!entry.isIntersecting) continue;
    if (processed.has(el)) { io.unobserve(el); continue; }

    const widthRatio = entry.boundingClientRect.width / vw;
    if (widthRatio < MIN_VIEWPORT_WIDTH_RATIO) {
      io.unobserve(el);
      observed.delete(el);
      processed.add(el);
      continue;
    }

    // Re-validate live (DOM may have changed)
    if (isInNav(el)) {
      io.unobserve(el);
      observed.delete(el);
      processed.add(el);
      continue;
    }
    if (!hasVisibleParagraph(el)) {
      io.unobserve(el);
      observed.delete(el);
      processed.add(el);
      continue;
    }

    let prompt = cleanText(el);
    if (prompt.length < MIN_TEXT_LENGTH || !hasSentenceWithMoreThanFiveWords(prompt)) {
      io.unobserve(el);
      observed.delete(el);
      processed.add(el);
      continue;
    }
    if (prompt.length > MAX_PROMPT_LENGTH) prompt = prompt.slice(0, MAX_PROMPT_LENGTH);

    ensureSingleBubble(el, prompt);

    io.unobserve(el);
    observed.delete(el);
    processed.add(el);
  }
}, {
  root: null,
  rootMargin: "200px 0px 200px 0px",
  threshold: 0.01
});

// Initial scan
function initialScan() {
  const root = document.body || document.documentElement;
  if (!root) return;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        // fast path: only DIV nodes
        if (node.tagName !== "DIV") return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  const BATCH = 2000;
  let count = 0;
  const batch = [];
  while (walker.nextNode()) {
    const el = /** @type {HTMLElement} */ (walker.currentNode);
    if (isEligibleDiv(el)) batch.push(el);
    if (++count % BATCH === 0) {
      const toAdd = batch.splice(0, batch.length);
      for (let i = 0; i < toAdd.length; i++) enqueue(toAdd[i]);
    }
  }
  for (let i = 0; i < batch.length; i++) enqueue(batch[i]);
}

// Mutations (ignore our nodes completely to avoid self-trigger loops)
const mo = new MutationObserver((mutations) => {
  let added = 0;
  for (let mi = 0; mi < mutations.length; mi++) {
    const m = mutations[mi];

    if (m.addedNodes && m.addedNodes.length) {
      for (let j = 0; j < m.addedNodes.length; j++) {
        const node = m.addedNodes[j];
        if (!(node instanceof Element)) continue;
        if (isOurNode(node)) continue; // ignore our containers
        if (node.tagName === "DIV") enqueue(node);

        // scan subtree for DIVs, but skip within our containers
        const list = node.querySelectorAll ? node.querySelectorAll("div") : [];
        for (let k = 0; k < list.length; k++) {
          const d = list[k];
          if (isOurNode(d)) continue;
          enqueue(d);
          if (++added > 5000) break; // safety valve
        }
      }
    }
  }
});

function init() {
  try {
    if (/^(?:https?:)?\/\/gemini\.google\.com\//.test(location.href)) return;
    initialScan();
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init, { once: true });
}
