
const statusEl = document.getElementById('status');
const sumBtn = document.getElementById('btn-sum');
const sumOut = document.getElementById('sum-out');
const sumProgress = document.getElementById('sum-progress');

const promptInput = document.getElementById('prompt');
const promptBtn = document.getElementById('btn-prompt');
const promptOut = document.getElementById('prompt-out');
const promptProgress = document.getElementById('prompt-progress');

async function checkAvailability() {
  try {
    const sumAvail = typeof Summarizer !== 'undefined' ? await Summarizer.availability() : 'unsupported';
    const lmAvail = typeof LanguageModel !== 'undefined' ? await LanguageModel.availability() : 'unsupported';
    statusEl.textContent = `Summarizer: ${sumAvail} • Prompt: ${lmAvail}`;
  } catch (e) {
    statusEl.textContent = 'Availability check failed: ' + e.message;
  }
}

async function getActiveTabText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return '';
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.body?.innerText ?? ''
  });
  return String(result || '');
}

sumBtn.addEventListener('click', async () => {
  sumOut.textContent = '';
  sumProgress.textContent = 'Starting…';
  try {
    if (typeof Summarizer === 'undefined') {
      sumProgress.textContent = 'Summarizer unsupported in this Chrome.';
      return;
    }
    const availability = await Summarizer.availability();
    if (availability === 'unavailable') {
      sumProgress.textContent = 'Summarizer unavailable on this device.';
      return;
    }
    const summarizer = await Summarizer.create({
      type: 'key-points',
      format: 'markdown',
      length: 'short',
      monitor(m) {
        m.addEventListener('downloadprogress', e => {
          sumProgress.textContent = `Downloading model… ${(e.loaded * 100).toFixed(0)}%`;
        });
      }
    });
    const text = await getActiveTabText();
    const summary = await summarizer.summarize(text, { context: 'Summarize for a quick TL;DR.' });
    sumOut.textContent = summary;
    sumProgress.textContent = '';
  } catch (e) {
    sumProgress.textContent = 'Error';
    sumOut.textContent = e.message || String(e);
  }
});

promptBtn.addEventListener('click', async () => {
  promptOut.textContent = '';
  promptProgress.textContent = 'Starting…';
  const q = (promptInput.value || '').trim();
  if (!q) {
    promptOut.textContent = 'Enter a prompt.';
    promptProgress.textContent = '';
    return;
  }
  try {
    if (typeof LanguageModel === 'undefined') {
      promptProgress.textContent = 'Prompt API unsupported in this Chrome.';
      return;
    }
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      promptProgress.textContent = 'Prompt API unavailable on this device.';
      return;
    }
    const session = await LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', e => {
          promptProgress.textContent = `Downloading model… ${(e.loaded * 100).toFixed(0)}%`;
        });
      }
    });
    const pageText = await getActiveTabText();
    const system = 'You are a helpful assistant inside a Chrome extension. Keep answers concise.';
    const question = q + '\n\nContext (may be truncated):\n' + pageText.slice(0, 5000);
    const answer = await session.prompt([
      { role: 'system', content: system },
      { role: 'user', content: question }
    ]);
    promptOut.textContent = String(answer);
    promptProgress.textContent = '';
  } catch (e) {
    promptProgress.textContent = 'Error';
    promptOut.textContent = e.message || String(e);
  }
});

checkAvailability();
