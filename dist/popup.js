"use strict";
(() => {
  // src/popup.ts
  var el = {
    scan: document.getElementById("scan"),
    exportBtn: document.getElementById("export"),
    sortBtn: document.getElementById("sort"),
    list: document.getElementById("list"),
    log: document.getElementById("log"),
    pauseToggle: document.getElementById("pauseToggle"),
    settingsBtn: document.getElementById("settingsBtn"),
    settings: document.getElementById("settings"),
    optLift: document.getElementById("opt-lift"),
    optDedupe: document.getElementById("opt-dedupe"),
    optSplit: document.getElementById("opt-split"),
    optFlat: document.getElementById("opt-flat"),
    resetBtn: document.getElementById("resetBtn"),
    integrate: document.getElementById("integrate")
  };
  var records = {};
  var options;
  var currentPhase = null;
  var keepAlivePort = null;
  init().catch(console.error);
  async function init() {
    options = await rpc({ type: "GET_OPTIONS" });
    if (el.optLift) el.optLift.checked = !!options.liftToDomain;
    if (el.optDedupe) el.optDedupe.checked = !!options.dedupe;
    if (el.optSplit) el.optSplit.checked = options.splitIntoFolders !== false;
    if (el.optFlat) el.optFlat.checked = !!options.flatMode;
    records = await rpc({ type: "GET_RECORDS" });
    render();
    try {
      keepAlivePort = chrome.runtime.connect({ name: "keep-alive" });
      setInterval(() => keepAlivePort?.postMessage({ ping: Date.now() }), 15e3);
    } catch {
    }
    el.scan.addEventListener("click", async () => {
      appendLog("> scan start");
      currentPhase = "SCAN";
      setProgressFill(0, 1);
      const payload = { type: "SCAN_BOOKMARKS", payload: {
        mode: void 0,
        limit: void 0,
        liftToDomain: el.optLift?.checked || false,
        dedupe: el.optDedupe?.checked || false,
        splitIntoFolders: el.optSplit?.checked !== false,
        flatMode: !!el.optFlat?.checked
      } };
      rpc(payload).catch(() => {
      });
    });
    el.exportBtn.addEventListener("click", async () => {
      const url = await rpc({ type: "EXPORT_CSV" });
      try {
        window.open(url, "_blank");
      } catch {
      }
    });
    el.sortBtn.addEventListener("click", async () => {
      await rpc({ type: "SORT_INVALID" });
      records = await rpc({ type: "GET_RECORDS" });
      render();
    });
    let paused = false;
    el.pauseToggle.addEventListener("click", async () => {
      if (!paused) {
        await rpc({ type: "PAUSE_SCAN" });
        paused = true;
        el.pauseToggle.textContent = "\u25B6";
      } else {
        await rpc({ type: "RESUME_SCAN" });
        paused = false;
        el.pauseToggle.textContent = "\u23F8";
      }
    });
    el.settingsBtn.addEventListener("click", () => {
      el.settings.hidden = !el.settings.hidden;
    });
    const updateOptions = async () => {
      const partial = {
        liftToDomain: !!el.optLift?.checked,
        dedupe: !!el.optDedupe?.checked,
        splitIntoFolders: el.optSplit?.checked !== false,
        flatMode: !!el.optFlat?.checked
      };
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
      records = {};
      render();
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "PROGRESS") {
        const { completed, total } = msg.payload;
        setProgressFill(completed, total);
        drawSpinnerLine(completed, total);
        if (completed % 10 === 0) {
          rpc({ type: "GET_RECORDS" }).then((r) => {
            records = r;
            render();
          }).catch(() => {
          });
        }
      } else if (msg?.type === "STATUS") {
        appendLog(msg.payload.text);
      } else if (msg?.type === "PHASE") {
        appendLog(`> ${msg.payload.name.toLowerCase()}${msg.payload.step ? ": " + msg.payload.step : ""}`);
        if (msg.payload.name === "SCAN") currentPhase = "SCAN";
        else if (msg.payload.name === "SORT") currentPhase = "SORT";
        else if (msg.payload.name === "INTEGRATE_SORTED") currentPhase = "INTEGRATE";
        setProgressFill(0, 1);
      } else if (msg?.type === "DONE") {
        appendLog(`\u2713 ${msg.payload.name.toLowerCase()} done`);
        rpc({ type: "GET_RECORDS" }).then((r) => {
          records = r;
          render();
        }).catch(() => {
        });
        setProgressFill(0, 1);
        currentPhase = null;
      } else if (msg?.type === "ERROR") {
        appendLog(`\u2717 ${msg.payload.text}`);
      } else if (msg?.type === "SNAPSHOT") {
        const { completed, total } = msg.payload;
        setProgressFill(completed, total);
        drawSpinnerLine(completed, total);
      }
    });
  }
  function appendLog(text) {
    if (!text) return;
    const atBottom = Math.abs(el.log.scrollTop + el.log.clientHeight - el.log.scrollHeight) < 4;
    const caret = el.log.querySelector(".caret");
    if (caret) caret.remove();
    el.log.textContent = `${el.log.textContent || ""}${text}
`;
    const c = document.createElement("span");
    c.className = "caret";
    el.log.appendChild(c);
    if (atBottom) el.log.scrollTop = el.log.scrollHeight;
  }
  function setProgressFill(completed, total) {
    const pct = total > 0 ? Math.min(100, Math.round(completed / total * 100)) : 0;
    const id = currentPhase === "SORT" ? "sort" : currentPhase === "INTEGRATE" ? "integrate" : "scan";
    const btn = document.getElementById(id);
    if (btn) btn.style.setProperty("--prog", pct + "%");
  }
  var spinnerFrames = ["\u280B", "\u2819", "\u2838", "\u2834", "\u2826", "\u2807"];
  var lastSpinnerIdx = 0;
  function drawSpinnerLine(completed, total) {
    const frame = spinnerFrames[lastSpinnerIdx % spinnerFrames.length];
    lastSpinnerIdx++;
    const ratio = total > 0 ? `${completed}/${total}` : `${completed}`;
    appendLog(`${frame} ${ratio}`);
  }
  async function rpc(payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(err);
          if (!res?.ok) return reject(new Error(res?.error || "RPC error"));
          resolve(res.data);
        });
      } catch (e) {
        reject(e);
      }
    });
  }
  function render() {
    const items = Object.values(records).filter((r) => r.ok);
    renderList(items);
  }
  function renderList(items) {
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
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[m]);
  }
})();
