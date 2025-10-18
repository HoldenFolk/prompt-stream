// contentScript.js

let toolbar, resultPanel, shadowRoot;
let lastSelectionText = "";
let askInputEl;

const STYLE_ID = "psHelperShadowRoot";
const TOOLBAR_ID = "ps-toolbar";
const PANEL_ID = "ps-result-panel";

// Inject a Shadow DOM root to isolate styles
function ensureShadowRoot() {
  if (shadowRoot) return shadowRoot;
  const host = document.createElement("div");
  host.id = STYLE_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);
  shadowRoot = host.attachShadow({ mode: "open" });
  return shadowRoot;
}

function createToolbar() {
  ensureShadowRoot();
  if (toolbar) return toolbar;

  const wrap = document.createElement("div");
  wrap.id = TOOLBAR_ID;
  wrap.innerHTML = `
    <div class="ps-card">
      <button class="ps-btn" data-action="summarize" title="Summarize">Summarize</button>
      <button class="ps-btn" data-action="facts" title="Key facts">Key Facts</button>
      <div class="ps-ask-row">
        <input type="text" placeholder="Ask a question…" class="ps-input" />
        <button class="ps-btn" data-action="ask" title="Ask">Ask</button>
      </div>
      <button class="ps-close" title="Close">×</button>
    </div>
  `;
  shadowRoot.appendChild(wrap);
  toolbar = wrap;

  askInputEl = toolbar.querySelector(".ps-input");

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;

    if (btn.classList.contains("ps-close")) {
      hideToolbar();
      return;
    }
    if (!lastSelectionText) return;

    if (action === "summarize") runAction("summarize");
    if (action === "facts") runAction("facts");
    if (action === "ask") {
      const q = askInputEl.value.trim();
      if (!q) {
        askInputEl.focus();
        return;
      }
      runAction("ask", q);
    }
  });

  return toolbar;
}

function showToolbar(x, y) {
  createToolbar();
  toolbar.style.display = "block";
  toolbar.style.left = `${x}px`;
  toolbar.style.top = `${y}px`;
}

function hideToolbar() {
  if (toolbar) toolbar.style.display = "none";
}

function createResultPanel() {
  ensureShadowRoot();
  if (resultPanel) return resultPanel;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="ps-card ps-result">
      <div class="ps-header">
        <span>PromptStream Result</span>
        <div class="ps-actions">
          <button class="ps-copy">Copy</button>
          <button class="ps-close">Close</button>
        </div>
      </div>
      <pre class="ps-content"></pre>
    </div>
  `;
  shadowRoot.appendChild(panel);
  resultPanel = panel;

  resultPanel.addEventListener("click", (e) => {
    const copyBtn = e.target.closest(".ps-copy");
    const closeBtn = e.target.closest(".ps-close");
    if (copyBtn) {
      const text = resultPanel.querySelector(".ps-content")?.innerText || "";
      navigator.clipboard.writeText(text).catch(() => {});
    }
    if (closeBtn) {
      resultPanel.style.display = "none";
    }
  });

  return resultPanel;
}

function showResult(text, anchorRect) {
  createResultPanel();
  const pre = resultPanel.querySelector(".ps-content");
  pre.textContent = text || "(no content)";
  resultPanel.style.display = "block";
  positionPanelNear(anchorRect);
}

function positionPanelNear(rect) {
  // place near bottom-left of selection by default
  const margin = 8;
  const left = Math.max(8, rect.left + window.scrollX);
  const top = Math.max(8, rect.bottom + window.scrollY + margin);
  resultPanel.style.left = `${left}px`;
  resultPanel.style.top = `${top}px`;
}

function getSelectionInfo() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return { text: "", rect: null };
  const text = sel.toString().trim();
  let rect = null;
  if (sel.rangeCount > 0) {
    rect = sel.getRangeAt(0).getBoundingClientRect();
  }
  return { text, rect };
}

async function runAction(kind, customQuestion = "") {
  if (!lastSelectionText) return;

  // Quick “loading” state
  showResult("Working…", lastRect || document.body.getBoundingClientRect());

  const payload = {
    mode: kind,
    selectionText: lastSelectionText,
    customQuestion
  };

  const res = await chrome.runtime.sendMessage({
    type: "LLM_REQUEST",
    payload
  });

  if (!res?.ok) {
    showResult(`Error: ${res?.error || "Unknown error"}`, lastRect);
    return;
  }
  const answer = res.data?.answer || "";
  showResult(answer, lastRect);
}

let lastRect = null;
document.addEventListener("mouseup", () => {
  const { text, rect } = getSelectionInfo();
  lastSelectionText = text;
  lastRect = rect;

  if (!text || !rect) {
    hideToolbar();
    return;
  }

  // position toolbar just to the right of selection rect
  const x = rect.right + window.scrollX + 6;
  const y = rect.top + window.scrollY - 6;
  showToolbar(x, y);
});

// Listen for background messages (e.g., context-menu "Ask a Question…")
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "PROMPT_QUESTION") {
    createToolbar();
    if (!lastRect) {
      const r = document.body.getBoundingClientRect();
      lastRect = r;
    }
    showToolbar((lastRect?.right || 100) + window.scrollX, (lastRect?.top || 100) + window.scrollY);
    askInputEl?.focus();
  }
  if (msg?.type === "RUN_ACTION") {
    const { kind, selectionText } = msg.payload || {};
    lastSelectionText = selectionText || lastSelectionText;
    if (!lastRect) {
      const r = document.body.getBoundingClientRect();
      lastRect = r;
    }
    runAction(kind);
  }
});
