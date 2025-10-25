
# Chrome AI Raw Boilerplate (MV3)

Plain HTML/JS/CSS Chrome extension showcasing **Summarizer API** and **Prompt API** (Gemini Nano), no build tools.

## Install (unpacked)
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Pin the extension → click the toolbar icon to open the popup

## Use
- **Summarize this page**: clicks use user activation; if the model isn't present, Chrome downloads it (progress shown).
- **Ask Gemini Nano**: prompts the on-device model; includes the current page text as context.
- This extension: A multi-modal Gemini assistant that instantly turns any text into three levels of understanding — Simple, Deep, and Expert.

## Permissions
- `activeTab`, `scripting` (to read page text), `storage` (reserved for future settings).

## Notes
- Requires a recent desktop Chrome with Built-in AI support and sufficient hardware/disk.
- If your device doesn't support Gemini Nano, add a server fallback in your app logic.
