export const DEFAULTS = {
  SUGGESTION_COUNT: 3,
  MAX_SUGGESTION_COUNT: 5,
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
  POPUP_PAYLOAD_DELIVER: "POPUP_PAYLOAD_DELIVER",
};

export const STORAGE_KEYS = {
  POPUP_PAYLOAD: "popupPayload",
};

export const USER_SETTINGS_KEYS = {
  SYSTEM_PROMPT: "systemPrompt",
  SUGGESTION_COUNT: "suggestionCount",
  SUGGESTION_TONE: "suggestionTone",
  MODEL_TEMPERATURE: "modelTemperature",
  MODEL_TOP_K: "modelTopK",
};

export const USER_SETTINGS_DEFAULTS = {
  [USER_SETTINGS_KEYS.SYSTEM_PROMPT]: "You are a concise assistant who responds with key bullet points.",
  [USER_SETTINGS_KEYS.SUGGESTION_COUNT]: 3,
  [USER_SETTINGS_KEYS.SUGGESTION_TONE]: "neutral",
  [USER_SETTINGS_KEYS.MODEL_TEMPERATURE]: 0.7,
  [USER_SETTINGS_KEYS.MODEL_TOP_K]: 3,
};
