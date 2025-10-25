import { DEFAULT_PARAMS, UI_STRINGS } from "../config.js";
import { ModelClient } from "../ai/modelClient.js";
import { els } from "../ui/dom.js";
import { setStatus, showProgress, setProgress } from "../ui/status.js";
import { getAvailability } from "../ai/apiShim.js";

const client = new ModelClient();
let lastClickedText = "";

// Auto-init if model is already downloaded
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const availability = await getAvailability();

    if (availability === "available") {
      setStatus("Model already downloaded — initializing...");
      await client.ensureReady({
        systemText: els.system.value,
        params: DEFAULT_PARAMS,
        onStatus: setStatus,
        onProgress: setProgress,
      });
      setStatus("Model ready.");
      els.run.disabled = false;
    } else {
      setStatus("Click 'Init / Download model' to download Gemini Nano.");
      els.init.disabled = false;
    }
  } catch (e) {
    setStatus(`Auto-init check failed: ${e.message}`);
  }
});

// Manual init/download (first-time setup)
els.init.addEventListener("click", async () => {
  els.init.disabled = true;
  try {
    showProgress(true);
    await client.ensureReady({
      systemText: els.system.value,
      params: DEFAULT_PARAMS,
      onStatus: setStatus,
      onProgress: setProgress,
    });
    showProgress(false);
    setStatus("Model ready. Click any page element to run.");
  } catch (err) {
    setStatus(`Init error: ${err.message}`);
    showProgress(false);
    els.init.disabled = false;
  }
});

// Listen for clicks from the content script
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === "ELEMENT_CLICKED_PROMPT") {
    lastClickedText = msg.text;
    setStatus("Running prompt from clicked element...");
    await runPromptFromText(lastClickedText);
  }
});

async function runPromptFromText(text) {
  if (!client.isReady) {
    setStatus(UI_STRINGS.initFirst);
    return;
  }

  els.out.textContent = "";
  try {
    for await (const chunk of client.promptStream(text)) {
      els.out.textContent += chunk;
    }
    setStatus("Done");
  } catch (err) {
    setStatus(`Run error: ${err.message}`);
  }
}

els.stop.addEventListener("click", () => {
  try { client.abort(); } catch {}
  setStatus("Aborted");
});
