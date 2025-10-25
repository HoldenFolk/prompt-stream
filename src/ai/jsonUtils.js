/** Extract the first balanced JSON object from a string (best-effort). */
export function extractJsonObject(s = "") {
    let depth = 0, start = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "{") { if (depth === 0) start = i; depth++; }
      else if (ch === "}") { depth--; if (depth === 0 && start !== -1) return s.slice(start, i + 1); }
    }
    return null;
  }
  
  /** Try parsing helpful-prompts JSON {prompts: string[]} from arbitrary text. */
  export function parsePromptsJson(text = "") {
    if (!text) return null;
  
    // 1) If wrapped in ```json ... ```
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fence ? fence[1] : text;
  
    try {
      const obj = JSON.parse(candidate);
      if (Array.isArray(obj?.prompts)) return obj;
    } catch { /* continue */ }
  
    // 2) Pull the biggest {} blob and try again
    const blob = extractJsonObject(candidate);
    if (blob) {
      try {
        const obj = JSON.parse(blob);
        if (Array.isArray(obj?.prompts)) return obj;
      } catch {}
    }
    return null;
  }
  
  /** Fallback: pull bullet/numbered lines if JSON fails. */
  export function salvagePrompts(text = "", n = 3) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const bullets = lines
      .map(l => l.replace(/^(\d+\.\s+|[-*•]\s+)/, ""))
      .filter((l, idx) => l !== lines[idx]); // only lines that matched
    const pool = bullets.length ? bullets : lines;
    return pool.slice(0, n);
  }
  