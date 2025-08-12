"use strict";
(() => {
  // src/export.ts
  async function initExportPage() {
    const csvArea = document.getElementById("csv");
    const meta = document.getElementById("meta");
    const btn = document.getElementById("download");
    const data = await chrome.storage.local.get(["lastCsv", "lastCsvUpdatedAt"]);
    const csv = data.lastCsv || "";
    const ts = data.lastCsvUpdatedAt ? new Date(data.lastCsvUpdatedAt).toLocaleString() : "-";
    if (csvArea) csvArea.value = csv;
    if (meta) meta.textContent = `updated: ${ts}`;
    if (btn) {
      btn.addEventListener("click", () => {
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `bookmark_meta_${Date.now()}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1e3);
      });
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    initExportPage().catch(console.error);
  });
})();
