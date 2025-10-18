// promptEngine.js

// ---------- Template Schema ----------
// id: unique string
// title: short label for UI
// mode: "summarize" | "facts" | "ask" | "rewrite" | etc.
// description: what this template does
// system: system prompt
// user: function({ text, question? }) -> string (returns a user prompt)
// detect: function(text) -> score [0..1]  (how well it fits)
// output: "markdown" | "json" (hint for renderer)

export const builtinTemplates = [
  {
    id: "generic_summarize",
    title: "Summarize",
    mode: "summarize",
    description: "Tight bullet summary of the key ideas.",
    system: "You are concise and accurate. Only use the provided content.",
    user: ({ text }) => [
      "Summarize the content in 5-8 bullet points focusing on core ideas, entities, and outcomes.",
      "",
      "Content:",
      "<<<", text, ">>>"
    ].join("\n"),
    detect: (t) => {
      // fallback: always applicable with low base score
      const len = t.length;
      return Math.max(0.2, Math.min(0.8, len / 4000)); // longer text → higher score
    },
    output: "markdown"
  },
  {
    id: "generic_facts",
    title: "Key Facts",
    mode: "facts",
    description: "Extract who/what/when/where and key numbers.",
    system: "You are precise. Answer only with facts from the content.",
    user: ({ text }) => [
      "Extract key factual details with labels. Include: Who, What, When, Where, Why (if present), How, Key Numbers/Stats, and ≤10-word notable quotes.",
      "",
      "Content:",
      "<<<", text, ">>>"
    ].join("\n"),
    detect: (t) => {
      const signals = [
        /\b\d{4}\b/g,                // years
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i, // months
        /\b(\$|€|£)\s?\d+/g,
        /\bpercent|%|increase|decrease|growth|decline\b/i,
        /\bwhere\b|\blocated\b|\bin\b/i
      ];
      const hits = signals.reduce((a, r) => a + (t.match(r)?.length || 0), 0);
      return Math.min(1, 0.15 + hits * 0.08);
    },
    output: "markdown"
  },
  {
    id: "qa_from_selection",
    title: "Answer a Question",
    mode: "ask",
    description: "Answer a user question using only the selected text.",
    system: "Base your answer strictly on the provided content. If uncertain, say so.",
    user: ({ text, question }) => [
      `Question: ${question}`,
      "",
      "Use only this content:",
      "<<<", text, ">>>"
    ].join("\n"),
    detect: (t) => 0.0, // not auto-suggested; invoked when user types a question
    output: "markdown"
  },
  // ---- Context-specific detectors ----
  {
    id: "academic_findings",
    title: "Key Findings (Academic)",
    mode: "facts",
    description: "Summarize study aim, method, results, limitations.",
    system: "You are a precise scientific summarizer.",
    user: ({ text }) => [
      "Summarize as bullets with labels: Objective, Method, Data, Results, Limitations, Implications.",
      "",
      "Content:",
      "<<<", text, ">>>"
    ].join("\n"),
    detect: (t) => {
      const k = /\b(Abstract|Method|Methods|Results|Discussion|Conclusion|Study|Participants|Dataset|p-?value|randomized|trial)\b/i;
      return k.test(t) ? 0.85 : 0.0;
    },
    output: "markdown"
  },
  {
    id: "job_post_extractor",
    title: "Extract Job Requirements",
    mode: "facts",
    description: "Pull role, responsibilities, skills, location, salary.",
    system: "Be structured and concise.",
    user: ({ text }) => [
      "Extract: Role Title, Responsibilities, Required Skills, Preferred Skills, Location/Remote, Salary/Compensation (if stated), How to Apply.",
      "",
      "Content:",
      "<<<", text, ">>>"
    ].join("\n"),
    detect: (t) => {
      const k = /\b(job|position|role|responsibilities|requirements|qualifications|salary|compensation|benefits|apply)\b/i;
      return k.test(t) ? 0.8 : 0.0;
    },
    output: "markdown"
  },
  {
    id: "game_when_where",
    title: "Game: When & Where",
    mode: "facts",
    description: "Find when the game takes place and the location.",
    system: "Answer only if present; otherwise say not found.",
    user: ({ text }) => [
      "From the content, extract:",
      "- When the game takes place (date/time/season/era)",
      "- Where it is located (venue/city/country or in-universe setting)",
      "",
      "Content:",
      "<<<", text, ">>>"
    ].join("\n"),
    detect: (t) => {
      const k = /\b(game|match|kickoff|tipoff|stadium|arena|map|level|quest|season)\b/i;
      return k.test(t) ? 0.7 : 0.0;
    },
    output: "markdown"
  },
  {
    id: "legal_obligations",
    title: "Legal: Obligations & Risks",
    mode: "facts",
    description: "Summarize obligations, liabilities, term, termination, and risks.",
    system: "You are careful and neutral. Do not give legal advice.",
    user: ({ text }) => [
      "Extract with labels: Parties, Scope, Obligations, Payment, Term & Termination, Liability, Indemnities, Confidentiality, Governing Law, Notable Risks/Ambiguities.",
      "",
      "Content:",
      "<<<", text, ">>>"
    ].join("\n"),
    detect: (t) => {
      const k = /\b(agreement|party|parties|indemnif|limitation of liability|governing law|term|termination|hereby)\b/i;
      return k.test(t) ? 0.75 : 0.0;
    },
    output: "markdown"
  },
  {
    id: "product_spec_extract",
    title: "Product Spec Extract",
    mode: "facts",
    description: "Key features, specs, price, compatibility.",
    system: "Be structured and factual.",
    user: ({ text }) => [
      "Extract: Product Name, Category, Key Features, Technical Specs, Price (if given), Compatibility, Variants, Notable Pros/Cons.",
      "",
      "Content:",
      "<<<", text, ">>>"
    ].join("\n"),
    detect: (t) => {
      const k = /\b(specs?|specifications|features|compatib|watt|hz|ghz|mah|dpi|bluetooth|usb|hdmi|msrp|price)\b/i;
      return k.test(t) ? 0.7 : 0.0;
    },
    output: "markdown"
  }
];

// Utility: normalize & quick-language cue (very lightweight)
function detectLanguage(text) {
  // Very rough: look for common tokens; default 'en'
  if (/[а-яё]/i.test(text)) return "sr/ru";
  if (/[àâçéèêëîïôûùüÿñæœ]/i.test(text)) return "fr";
  if (/[äöüß]/i.test(text)) return "de";
  return "en";
}

// Score templates and return best suggestion
export async function suggestTemplate(text, userTemplates = []) {
  const lang = detectLanguage(text);
  const candidates = [...userTemplates, ...builtinTemplates];

  let best = null;
  for (const t of candidates) {
    try {
      const score = Math.max(0, Math.min(1, Number(t.detect?.(text) || 0)));
      if (!best || score > best.score) best = { tpl: t, score };
    } catch {}
  }

  // If nothing scored above 0.3, fall back to generic summarize
  if (!best || best.score < 0.3) {
    const fallback = builtinTemplates.find(x => x.id === "generic_summarize");
    return { tpl: fallback, score: best?.score ?? 0.2, lang };
  }
  return { tpl: best.tpl, score: best.score, lang };
}

// Compose final LLM request payload
export function buildPromptFromTemplate(tpl, { text, question }) {
  const system = tpl.system || "You are a helpful assistant.";
  const user = tpl.user({ text, question });
  return { system, user, mode: tpl.mode, output: tpl.output, templateId: tpl.id, title: tpl.title };
}
