export const DEFAULTS = {
    SUGGESTION_COUNT: 3,
    MAX_SUGGESTION_COUNT: 3,
    MAX_PROMPT_LEN: 140,
    TONE: "neutral",
  };
  
  export const SYSTEM_SUGGESTER_TEXT = [
    "You are a prompt helper. Given user-provided text,",
    "propose concise, high-utility follow-up prompts.",
    'Return strictly JSON: { "prompts": ["...", "...", "..."] }',
    "Each prompt ≤ 140 characters, specific, actionable.",
    "No preambles, no extra keys, no markdown fences."
  ].join(" ");

  // constants.js
export const MSG = {
  CS_TO_BG_SEND_TO_POPUP: "CS_TO_BG_SEND_TO_POPUP",
  POPUP_PAYLOAD_DELIVER:  "POPUP_PAYLOAD_DELIVER",
};
export const STORAGE_KEYS = {
  POPUP_PAYLOAD: "popupPayload",
};