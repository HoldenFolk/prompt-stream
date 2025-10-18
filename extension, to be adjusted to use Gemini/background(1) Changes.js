// background.js (add at the top)
import { suggestTemplate, buildPromptFromTemplate, builtinTemplates } from "./promptEngine.js";

// helper to load user templates (optional)
async function getUserTemplates() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["ps_user_templates"], (res) => {
      const tpls = Array.isArray(res?.ps_user_templates) ? res.ps_user_templates : [];
      // basic sanity: ensure required fields exist
      const clean = tpls.filter(t => t && t.id && t.user && t.detect);
      resolve(clean);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "LLM_REQUEST") {
        const { mode, selectionText, customQuestion, temperature = 0.2 } = msg.payload || {};
        const apiKey = await getApiKey();
        if (!apiKey) throw new Error("Missing API key. Set it in Options.");

        let prompt, modeToUse = mode, chosenMeta = null;

        if (mode === "auto") {
          const userTemplates = await getUserTemplates();
          const { tpl, score } = await suggestTemplate(selectionText, userTemplates);
          chosenMeta = { templateId: tpl.id, title: tpl.title, score };
          prompt = buildPromptFromTemplate(tpl, { text: selectionText, question: customQuestion });
          modeToUse = tpl.mode || "summarize";
        } else {
          // Backward-compatible: reuse your existing buildPrompt() or map to builtinTemplates
          const map = {
            summarize: "generic_summarize",
            facts: "generic_facts",
            ask: "qa_from_selection"
          };
          const tplId = map[mode] || "generic_summarize";
          const tpl = builtinTemplates.find(t => t.id === tplId) || builtinTemplates[0];
          chosenMeta = { templateId: tpl.id, title: tpl.title, score: 0.5 };
          prompt = buildPromptFromTemplate(tpl, { text: selectionText, question: customQuestion });
        }

        const completion = await callOpenAI({ apiKey, prompt, temperature });
        sendResponse({ ok: true, data: completion, meta: chosenMeta });
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
  return true;
});

// Update callOpenAI to accept our new {system,user}
async function callOpenAI({ apiKey, prompt, temperature }) {
  const body = {
    model: "gpt-4o-mini",
    temperature,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user }
    ]
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI API error (${res.status}): ${text || res.statusText}`);
  }
  const data = await res.json();
  const answer = data?.choices?.[0]?.message?.content?.trim() || "";
  return { answer, raw: data, usedTemplate: prompt.templateId, mode: prompt.mode };
}
