// background.js

const PROVIDER = "openai"; // "openai" for now; you can add others later.
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini"; // fast & cheap; adjust as you like

chrome.runtime.onInstalled.addListener(() => {
  // Create context menu when the user selects text
  chrome.contextMenus.create({
    id: "ps_summarize",
    title: "PromptStream: Summarize Selection",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "ps_facts",
    title: "PromptStream: Extract Key Facts",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "ps_ask",
    title: "PromptStream: Ask a Question…",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  const selectionText = info.selectionText?.trim() || "";
  if (!selectionText) return;

  // For "Ask a Question…" prompt the user in-page
  if (info.menuItemId === "ps_ask") {
    chrome.tabs.sendMessage(tab.id, { type: "PROMPT_QUESTION" });
    return;
  }

  const kind = info.menuItemId === "ps_summarize" ? "summarize" : "facts";
  chrome.tabs.sendMessage(tab.id, {
    type: "RUN_ACTION",
    payload: { kind, selectionText }
  });
});

// Receive requests from content script to call the LLM
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "LLM_REQUEST") {
        const { mode, selectionText, customQuestion, temperature = 0.2 } = msg.payload || {};
        const apiKey = await getApiKey();
        if (!apiKey) {
          throw new Error("Missing API key. Set it in the extension options.");
        }
        const prompt = buildPrompt({ mode, selectionText, customQuestion });
        const completion = await callOpenAI({ apiKey, prompt, temperature });
        sendResponse({ ok: true, data: completion });
      }
    } catch (err) {
      console.error(err);
      sendResponse({ ok: false, error: err.message || String(err) });
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/48.png",
          title: "PromptStream Helper",
          message: `Error: ${err.message || err}`
        });
      } catch {}
    }
  })();

  // required to keep the message channel open for async
  return true;
});

function buildPrompt({ mode, selectionText, customQuestion }) {
  const system = [
    "You are a concise, trustworthy assistant.",
    "Always base your answers ONLY on the provided content.",
    "When asked to extract facts, return a compact bullet list where possible.",
    "If the content lacks an answer, explicitly say you cannot find it."
  ].join(" ");

  const tasks = {
    summarize:
      "Summarize the content in 5-8 tight bullet points focusing on the core ideas, entities, and outcomes. Avoid fluff.",
    facts:
      "Extract key factual details with labels. Prefer a compact bullet list. If present, include: Who, What, When, Where, Why, How, Key Numbers/Stats, and Notable Quotes (<=10 words).",
    ask: `Answer the user's question using only the content. If the answer is uncertain, note the uncertainty clearly.`
  };

  const task = mode === "summarize" ? tasks.summarize : mode === "facts" ? tasks.facts : tasks.ask;

  const user = [
    mode === "ask" ? `Question: ${customQuestion}` : `Task: ${task}`,
    "",
    "Content:",
    "<<<",
    selectionText,
    ">>>"
  ].join("\n");

  return { system, user };
}

async function callOpenAI({ apiKey, prompt, temperature }) {
  const body = {
    model: OPENAI_MODEL,
    temperature,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ]
  };

  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI API error (${res.status}): ${text || res.statusText}`);
  }
  const data = await res.json();
  const answer = data?.choices?.[0]?.message?.content?.trim() || "";
  return { answer, raw: data };
}

function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["ps_api_key"], (res) => resolve(res?.ps_api_key || ""));
  });
}
