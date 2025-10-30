# PromptStream

PromptStream is a Chrome extension that blends Chrome's on-device Gemini Nano model with a lightweight workflow for highlighting text, generating prompt ideas, and continuing the conversation in a dedicated workspace tab. Everything runs locally—no backend required.

## Features

- **Selection helper** – highlight text on any page to receive a configurable number of Gemini-ready prompt suggestions.
- **Workspace tab** – auto-opens when you choose a suggestion, streams responses in real time, and maintains the full conversation.
- **Unified settings** – the toolbar popup acts as a control panel for the system prompt, suggestion tone/count, and Gemini Nano parameters (temperature and top-k).
- **Persistent preferences** – settings sync via `chrome.storage.sync` (with localStorage fallback) so they roam across devices.
- **Graceful fallbacks** – handles delayed model availability, download progress, and device capability errors without crashing.

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the project root.
5. Pin PromptStream from the extensions toolbar for quick access.

## Using PromptStream

- **Configure defaults**: click the toolbar icon to open the settings popup. Adjust the system instruction, suggestion tone/count, or Gemini Nano tuning (temperature & top-k). Changes save automatically.
- **Highlight for ideas**: select text on any page (except Gemini itself). A floating card appears with up to five AI-generated prompt suggestions.
- **Continue the chat**: choose a suggestion to open the full-page workspace tab. The chosen prompt and context are injected automatically, and Gemini Nano streams the reply. Use the workspace like a normal chat client (send, stop, reset).

## Project Structure

```
src/
├── ai/              # Gemini API shims, session manager, prompt suggester
├── background.js    # Service worker: routing, offscreen setup, workspace tabs
├── content/         # Selection helper + Gemini web injector
├── offscreen/       # Offscreen document that runs prompt suggestions
├── popup/           # Settings popup, workspace tab, shared styles/assets
├── ui/              # Small DOM/status helpers used by workspace chat
└── config.js        # Shared UI strings
```

## Key Concepts

- **On-device Gemini**: `SessionManager` (in `src/ai/sessionManager.js`) abstracts availability checks, download progress, and parameter injection for the Chrome Prompt API.
- **Selection pipeline**: `content_select.js` gathers highlighted text, requests prompt ideas from the background worker, and handles caching/lifecycle edge cases.
- **Workspace chat**: `popup/tab.html` + `popup.js` share the same chat logic, reusing the persistent system prompt/settings from the popup.
- **Settings persistence**: `popup/settings.js` reads/writes to `chrome.storage.sync` when available, with a transparent localStorage fallback for browsers that disable sync storage.

## Permissions

- `activeTab`, `scripting` – capture selected text and inject contextual helpers.
- `storage` – persist settings (system prompt, suggestion count/tone, model params).
- `clipboardWrite` – legacy permission retained for future enhancements (currently unused but harmless).
- `offscreen` – hosts an offscreen document to run prompt-suggestion requests without blocking the service worker.

## Development Notes

- The extension targets Chrome MV3 with on-device AI enabled (Chrome >125 on supported hardware).
- No build step is required; all assets are plain HTML/CSS/JS modules.
- The repository intentionally avoids bundlers—feel free to adopt one if you plan to ship to the Chrome Web Store.

## License

[MIT](LICENSE)
