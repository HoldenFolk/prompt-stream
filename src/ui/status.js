import { els } from "./dom.js";

export function setStatus(text) {
  els.status.textContent = `Status: ${text}`;
}

export function showProgress(show) {
  els.progressWrap.style.display = show ? "block" : "none";
}

export function setProgress(pct, loadedFraction) {
  els.progress.value = Math.max(0, Math.min(100, pct));
  // Optional note for debugging / user info
  if (typeof loadedFraction === "number") {
    els.progressNote.textContent = `Loaded: ${(loadedFraction * 100).toFixed(1)}%`;
  }
}