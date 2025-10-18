// options.js
const apiInput = document.getElementById("api");
const tempInput = document.getElementById("temp");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("save");

function load() {
  chrome.storage.sync.get(["ps_api_key", "ps_temperature"], (vals) => {
    if (vals.ps_api_key) apiInput.value = vals.ps_api_key;
    if (typeof vals.ps_temperature === "number") tempInput.value = String(vals.ps_temperature);
  });
}

saveBtn.addEventListener("click", () => {
  const key = apiInput.value.trim();
  const tRaw = tempInput.value.trim();
  const temp = Math.min(1, Math.max(0, Number(tRaw || "0.2")));
  chrome.storage.sync.set({ ps_api_key: key, ps_temperature: temp }, () => {
    statusEl.textContent = "Saved.";
    setTimeout(() => (statusEl.textContent = ""), 1500);
  });
});

load();
