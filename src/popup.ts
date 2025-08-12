import type { LinkRecord, RecordsMap, ScanOptions, BgMessage } from "./types";

const el = {
  scan: document.getElementById("scan") as HTMLButtonElement,
  exportBtn: document.getElementById("export") as HTMLButtonElement,
  sortBtn: document.getElementById("sort") as HTMLButtonElement,
  list: document.getElementById("list") as HTMLUListElement,
  log: document.getElementById("log") as HTMLPreElement,
  pauseToggle: document.getElementById("pauseToggle") as HTMLButtonElement,
  settingsBtn: document.getElementById("settingsBtn") as HTMLButtonElement,
  settings: document.getElementById("settings") as HTMLDivElement,
  optLift: document.getElementById("opt-lift") as HTMLInputElement,
  optDedupe: document.getElementById("opt-dedupe") as HTMLInputElement,
  optSplit: document.getElementById("opt-split") as HTMLInputElement,
  optFlat: document.getElementById("opt-flat") as HTMLInputElement,
  resetBtn: document.getElementById("resetBtn") as HTMLButtonElement,
  integrate: document.getElementById("integrate") as HTMLButtonElement,
};

let records: RecordsMap = {};
let options: ScanOptions;
let currentPhase: 'SCAN' | 'SORT' | 'INTEGRATE' | null = null;
let keepAlivePort: chrome.runtime.Port | null = null;

init().catch(console.error);

async function init() {
  options = await rpc<ScanOptions>({ type: "GET_OPTIONS" });
  // init settings UI from options
  if (el.optLift) el.optLift.checked = !!options.liftToDomain;
  if (el.optDedupe) el.optDedupe.checked = !!options.dedupe;
  if (el.optSplit) el.optSplit.checked = options.splitIntoFolders !== false;
  if (el.optFlat) el.optFlat.checked = !!options.flatMode;

  records = await rpc<RecordsMap>({ type: "GET_RECORDS" });
  render();

  // keep-alive port
  try {
    keepAlivePort = chrome.runtime.connect({ name: "keep-alive" });
    setInterval(() => keepAlivePort?.postMessage({ ping: Date.now() }), 15000);
  } catch {}

  el.scan.addEventListener("click", async () => {
    appendLog("> scan start");
    currentPhase = 'SCAN';
    setProgressFill(0, 1);
    const payload: any = { type: "SCAN_BOOKMARKS", payload: {
      mode: undefined,
      limit: undefined,
      liftToDomain: el.optLift?.checked || false,
      dedupe: el.optDedupe?.checked || false,
      splitIntoFolders: el.optSplit?.checked !== false,
      flatMode: !!el.optFlat?.checked,
    }};
    // fire-and-forget; updates will come via events
    rpc(payload).catch(() => {});
  });

  el.exportBtn.addEventListener("click", async () => {
    const url = await rpc<string>({ type: "EXPORT_CSV" });
    // If downloads API didn't prompt, open object URL
    try { window.open(url, "_blank"); } catch {}
  });

  el.sortBtn.addEventListener("click", async () => {
    await rpc({ type: "SORT_INVALID" });
    records = await rpc<RecordsMap>({ type: "GET_RECORDS" });
    render();
  });

  // Catalog is now part of Sort phase (second phase inside sort on backend). Removing the button action.

  let paused = false;
  el.pauseToggle.addEventListener("click", async () => {
    if (!paused) { await rpc({ type: "PAUSE_SCAN" }); paused = true; el.pauseToggle.textContent = "▶"; }
    else { await rpc({ type: "RESUME_SCAN" }); paused = false; el.pauseToggle.textContent = "⏸"; }
  });

  el.settingsBtn.addEventListener("click", () => { el.settings.hidden = !el.settings.hidden; });

  // persist settings
  const updateOptions = async () => {
    const partial: Partial<ScanOptions> = {
      liftToDomain: !!el.optLift?.checked,
      dedupe: !!el.optDedupe?.checked,
      splitIntoFolders: el.optSplit?.checked !== false,
      flatMode: !!el.optFlat?.checked,
    } as any;
    await rpc({ type: "SET_OPTIONS", payload: partial });
  };
  el.optLift?.addEventListener("change", updateOptions);
  el.optDedupe?.addEventListener("change", updateOptions);
  el.optSplit?.addEventListener("change", updateOptions);
  el.optFlat?.addEventListener("change", updateOptions);

  el.integrate.addEventListener("click", async () => {
    await rpc({ type: "INTEGRATE_SORTED" });
  });

  el.resetBtn.addEventListener("click", async () => {
    appendLog("> reset records");
    await rpc({ type: "CLEAR_RECORDS" });
    records = {} as RecordsMap;
    render();
  });

  chrome.runtime.onMessage.addListener((msg: BgMessage) => {
    if (msg?.type === "PROGRESS") {
      const { completed, total } = msg.payload;
      setProgressFill(completed, total);
      // terminal animation line: spinner + ratio
      drawSpinnerLine(completed, total);
      // live refresh subset every 10 steps
      if (completed % 10 === 0) {
        rpc<RecordsMap>({ type: "GET_RECORDS" }).then((r) => { records = r; render(); }).catch(() => {});
      }
    } else if (msg?.type === "STATUS") {
      appendLog(msg.payload.text);
    } else if (msg?.type === "PHASE") {
      appendLog(`> ${msg.payload.name.toLowerCase()}${msg.payload.step ? ": "+msg.payload.step : ""}`);
      // map phases to which button gets progress fill
      if (msg.payload.name === 'SCAN') currentPhase = 'SCAN';
      else if (msg.payload.name === 'SORT') currentPhase = 'SORT';
      else if (msg.payload.name === 'INTEGRATE_SORTED') currentPhase = 'INTEGRATE';
      // reset fill at phase start
      setProgressFill(0, 1);
    } else if (msg?.type === "DONE") {
      appendLog(`✓ ${msg.payload.name.toLowerCase()} done`);
      rpc<RecordsMap>({ type: "GET_RECORDS" }).then((r) => { records = r; render(); }).catch(() => {});
      setProgressFill(0, 1);
      currentPhase = null;
    } else if (msg?.type === "ERROR") {
      appendLog(`✗ ${msg.payload.text}`);
    } else if (msg?.type === "SNAPSHOT") {
      const { completed, total } = msg.payload;
      setProgressFill(completed, total);
      drawSpinnerLine(completed, total);
    }
  });
}

function appendLog(text: string) {
  if (!text) return;
  const atBottom = Math.abs(el.log.scrollTop + el.log.clientHeight - el.log.scrollHeight) < 4;
  // replace blinking caret if present
  const caret = el.log.querySelector('.caret');
  if (caret) caret.remove();
  el.log.textContent = `${el.log.textContent || ""}${text}\n`;
  const c = document.createElement('span'); c.className = 'caret'; el.log.appendChild(c);
  if (atBottom) el.log.scrollTop = el.log.scrollHeight;
}

function setProgressFill(completed: number, total: number) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const id = currentPhase === 'SORT' ? 'sort' : currentPhase === 'INTEGRATE' ? 'integrate' : 'scan';
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (btn) btn.style.setProperty("--prog", pct + "%");
}

const spinnerFrames = ['⠋','⠙','⠸','⠴','⠦','⠇'];
let lastSpinnerIdx = 0;
function drawSpinnerLine(completed: number, total: number) {
  const frame = spinnerFrames[lastSpinnerIdx % spinnerFrames.length];
  lastSpinnerIdx++;
  const ratio = total > 0 ? `${completed}/${total}` : `${completed}`;
  appendLog(`${frame} ${ratio}`);
}

async function rpc<T = any>(payload: any): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(err);
        if (!res?.ok) return reject(new Error(res?.error || "RPC error"));
        resolve(res.data as T);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function render() {
  // Only working links
  const items = Object.values(records).filter((r) => r.ok);
  renderList(items);
}

function renderList(items: LinkRecord[]) {
  el.list.innerHTML = "";
  for (const r of items) {
    const li = document.createElement("li");
    li.className = r.ok ? "ok" : "err";
    li.innerHTML = `
      <div class="row">
        <a href="${r.url}" target="_blank" rel="noreferrer">${escapeHtml(r.title || r.url)}</a>
        <time>${new Date(r.lastFetchedAt).toLocaleString()}</time>
      </div>
      <p class="desc">${escapeHtml(r.description)}</p>
    `;
    el.list.appendChild(li);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]!));
}


