async function initExportPage(): Promise<void> {
  const csvArea = document.getElementById("csv") as HTMLTextAreaElement | null;
  const meta = document.getElementById("meta") as HTMLSpanElement | null;
  const btn = document.getElementById("download") as HTMLButtonElement | null;

  const data = await chrome.storage.local.get(["lastCsv", "lastCsvUpdatedAt"]);
  const csv = (data.lastCsv as string) || "";
  const ts = data.lastCsvUpdatedAt ? new Date(data.lastCsvUpdatedAt as number).toLocaleString() : "-";
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
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initExportPage().catch(console.error);
});


