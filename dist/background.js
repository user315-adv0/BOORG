// src/utils.ts
function flattenBookmarks(nodes) {
  const urls = [];
  const walk = (n) => {
    if (n.url) urls.push(n.url);
    if (n.children) n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return urls;
}
function isHttpUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function normalizeToDomainRoot(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.hostname}/`;
  } catch {
    return urlStr;
  }
}
function dedupe(list) {
  return Array.from(new Set(list));
}
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}
function parseHtmlMeta(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = cleanupText(titleMatch?.[1] ?? "");
  const desc = matchMeta(html, "description") || matchOg(html, "description") || "";
  return { title, description: cleanupText(desc) };
}
function matchMeta(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']?${escapeRegex(name)}["']?[^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return;
  const content = tag.match(/content=["']([\s\S]*?)["']/i)?.[1];
  return content;
}
function matchOg(html, prop) {
  const re = new RegExp(`<meta[^>]+property=["']?og:${escapeRegex(prop)}["']?[^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return;
  const content = tag.match(/content=["']([\s\S]*?)["']/i)?.[1];
  return content;
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function cleanupText(s) {
  return s.replace(/\s+/g, " ").trim();
}
var STOPWORDS_RU = /* @__PURE__ */ new Set([]);
var STOPWORDS_EN = /* @__PURE__ */ new Set([
  "the",
  "and",
  "a",
  "an",
  "to",
  "of",
  "in",
  "for",
  "on",
  "at",
  "by",
  "is",
  "it",
  "this",
  "that",
  "with",
  "as",
  "from",
  "or",
  "are",
  "be",
  "was",
  "were",
  "but",
  "not",
  "we",
  "you",
  "they",
  "their",
  "our",
  "your",
  "about",
  "all",
  "can",
  "has",
  "have",
  "will",
  "more",
  "one",
  "two",
  "new",
  "how",
  "what",
  "why",
  "when",
  "where",
  "which",
  "who",
  "use",
  "using",
  "used",
  "into",
  "over",
  "if",
  "also",
  "may",
  "just"
]);
function extractTags(text, maxTags = 10) {
  const words = text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS_EN.has(w) && !STOPWORDS_RU.has(w));
  const freq = /* @__PURE__ */ new Map();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, maxTags).map(([w]) => w);
}
function categorizeRecord(input) {
  const { url, title, description, tags } = input;
  const lc = `${title} ${description}`.toLowerCase();
  const hostname = safeHostname(url);
  if (hostname) {
    if (/github\.com$/.test(hostname)) return "Code";
    if (/stackoverflow\.com$/.test(hostname)) return "QA";
    if (/wikipedia\.org$/.test(hostname)) return "Reference";
    if (/(^|\.)arxiv\.org$/.test(hostname)) return "Research";
    if (/medium\.com$/.test(hostname)) return "Blogs";
    if (/(youtube\.com|youtu\.be|vimeo\.com)$/.test(hostname)) return "Video";
    if (/(x\.com|twitter\.com)$/.test(hostname)) return "Social";
    if (/linkedin\.com$/.test(hostname)) return "Career";
    if (/reddit\.com$/.test(hostname)) return "Communities";
    if (/(docs\.|developer\.|dev\.)/.test(hostname)) return "Docs";
  }
  const hasTag = (arr) => arr.some((t) => tags.includes(t));
  const rules = [
    { name: "AI/ML", any: [/machine learning|deep learning|neural|llm|gpt|transformer|nlp|cv\b|classification|regression/i, "ml", "ai"] },
    { name: "Programming", any: ["javascript", "typescript", "python", "go", "rust", "java", "kotlin", "php", "ruby", "c++", "c#", "swift", "dart", "node", "react", "vue", "svelte", "angular", "next", "nuxt"] },
    { name: "DevOps", any: ["docker", "kubernetes", "k8s", "terraform", "ansible", "ci", "cd", "jenkins", "github actions", "monitoring", "prometheus", "grafana"] },
    { name: "Security", any: ["security", "oauth", "jwt", "xss", "csrf", "encryption", "vulnerability", "penetration"] },
    { name: "Cloud", any: ["aws", "gcp", "azure", "cloudflare", "serverless", "lambda", "cloud run"] },
    { name: "Data", any: ["sql", "postgres", "mysql", "mongodb", "clickhouse", "data warehouse", "etl", "airflow", "spark", "hadoop"] },
    { name: "Design", any: ["figma", "ux", "ui", "design", "typography", "color", "interface"] },
    { name: "Business", any: ["startup", "marketing", "product", "growth", "sales", "pricing"] },
    { name: "Crypto", any: ["crypto", "blockchain", "ethereum", "defi", "nft"] },
    { name: "Mobile", any: ["android", "ios", "react native", "flutter", "swiftui"] },
    { name: "Testing", any: ["test", "testing", "jest", "cypress", "playwright", "unit", "e2e"] },
    { name: "Docs", any: ["documentation", "api reference", "reference", "guide", "manual"] },
    { name: "Research", any: ["paper", "arxiv", "doi", "research", "study"] }
  ];
  for (const { name, any } of rules) {
    for (const k of any) {
      if (typeof k === "string") {
        if (lc.includes(k) || hasTag([k])) return name;
      } else {
        if (k.test(lc)) return name;
      }
    }
  }
  if (tags.length > 0) return capitalize(tags[0]);
  if (hostname) return hostname.replace(/^www\./, "");
  return "Misc";
}
function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return void 0;
  }
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function buildTagHierarchy(items, config = { maxLevel1: 12, maxLevel2: 8, maxLevel3: 6, minCount: 3 }) {
  const docFreq = /* @__PURE__ */ new Map();
  const inc = (m, k, d = 1) => m.set(k, (m.get(k) ?? 0) + d);
  for (const it of items) {
    const uniq = Array.from(new Set(it.tags));
    for (const t of uniq) inc(docFreq, t, 1);
  }
  const sortedTags = Array.from(docFreq.entries()).filter(([, c]) => c >= config.minCount).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const level1 = sortedTags.slice(0, config.maxLevel1);
  const level2 = /* @__PURE__ */ new Map();
  const level3 = /* @__PURE__ */ new Map();
  const itemsWith = (required) => items.filter((it) => required.every((t) => it.tags.includes(t)));
  for (const l1 of level1) {
    const counts2 = /* @__PURE__ */ new Map();
    for (const it of itemsWith([l1])) {
      for (const t of new Set(it.tags)) {
        if (t === l1) continue;
        inc(counts2, t, 1);
      }
    }
    const l2 = Array.from(counts2.entries()).filter(([, c]) => c >= config.minCount).sort((a, b) => b[1] - a[1]).slice(0, config.maxLevel2).map(([t]) => t);
    level2.set(l1, l2);
    for (const l2t of l2) {
      const counts3 = /* @__PURE__ */ new Map();
      for (const it of itemsWith([l1, l2t])) {
        for (const t of new Set(it.tags)) {
          if (t === l1 || t === l2t) continue;
          inc(counts3, t, 1);
        }
      }
      const l3 = Array.from(counts3.entries()).filter(([, c]) => c >= config.minCount).sort((a, b) => b[1] - a[1]).slice(0, config.maxLevel3).map(([t]) => t);
      level3.set(`${l1}//${l2t}`, l3);
    }
  }
  return { level1, level2, level3, docFreq };
}

// src/storage.ts
var Storage = class {
  async getAll() {
    return new Promise((resolve) => chrome.storage.local.get(["options", "records"], resolve));
  }
  async getOptionsOrDefault(defaults) {
    const { options } = await this.getAll();
    return { ...defaults, ...options ?? {} };
  }
  async setOptions(options) {
    const current = await this.getOptionsOrDefault({ liftToDomain: false, timeoutMs: 8e3, parallel: 6, splitIntoFolders: true, flatMode: false });
    await chrome.storage.local.set({ options: { ...current, ...options } });
  }
  async getRecords() {
    const { records } = await this.getAll();
    return records ?? {};
  }
  async setRecords(records) {
    await chrome.storage.local.set({ records });
  }
};

// src/background.ts
var DEFAULT_OPTIONS = {
  liftToDomain: false,
  timeoutMs: 8e3,
  parallel: 6,
  splitIntoFolders: true,
  flatMode: false
};
var storage = new Storage();
var scanState = null;
var resumeResolver = null;
var busyOp = null;
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keep-alive") return;
  port.onMessage.addListener((_msg) => {
  });
});
chrome.runtime.onInstalled.addListener(async () => {
  const { options } = await storage.getAll();
  if (!options) await storage.setOptions(DEFAULT_OPTIONS);
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "GET_OPTIONS": {
        const { options } = await storage.getAll();
        sendResponse({ ok: true, data: options ?? DEFAULT_OPTIONS });
        break;
      }
      case "SET_OPTIONS": {
        await storage.setOptions(msg.payload);
        sendResponse({ ok: true });
        break;
      }
      case "GET_RECORDS": {
        const { records } = await storage.getAll();
        sendResponse({ ok: true, data: records ?? {} });
        break;
      }
      case "CLEAR_RECORDS": {
        await storage.setRecords({});
        sendResponse({ ok: true });
        break;
      }
      case "SCAN_BOOKMARKS": {
        if (busyOp) {
          sendResponse({ ok: false, error: `busy: ${busyOp}` });
          break;
        }
        const merged = { ...await storage.getOptionsOrDefault(DEFAULT_OPTIONS), ...msg.payload ?? {} };
        sendResponse({ ok: true });
        busyOp = "SCAN";
        scanAndStore(merged).catch((e) => sendStatus(`scan error: ${String(e)}`)).finally(() => {
          busyOp = null;
        });
        break;
      }
      case "PAUSE_SCAN": {
        if (scanState?.inProgress) {
          scanState.paused = true;
          sendStatus("scan paused");
        }
        sendResponse({ ok: true });
        break;
      }
      case "RESUME_SCAN": {
        if (scanState?.inProgress && scanState.paused) {
          scanState.paused = false;
          if (resumeResolver) {
            const r = resumeResolver;
            resumeResolver = null;
            r();
          }
          sendStatus("scan resumed");
        }
        sendResponse({ ok: true });
        break;
      }
      case "EXPORT_CSV": {
        exportCsv().then(
          (url) => sendResponse({ ok: true, data: url }),
          (e) => sendResponse({ ok: false, error: String(e) })
        );
        break;
      }
      case "SORT_INVALID": {
        if (busyOp) {
          sendResponse({ ok: false, error: `busy: ${busyOp}` });
          break;
        }
        busyOp = "SORT";
        (async () => {
          sendPhase("SORT", "start");
          await removeInvalidRecords();
          const opts = await storage.getOptionsOrDefault(DEFAULT_OPTIONS);
          if (opts.flatMode) {
            await catalogizeFlat({ applyLift: !!opts.liftToDomain, applyDedupe: !!opts.dedupe });
          } else {
            if (opts.splitIntoFolders) {
              await catalogizeByMeaningTop8();
            } else {
              if (opts.liftToDomain || opts.dedupe) {
                await mirrorOriginalStructure({ applyLift: !!opts.liftToDomain, applyDedupe: !!opts.dedupe });
              } else {
                sendStatus("No organization selected - only invalid links removed");
              }
            }
          }
          sendDone("SORT");
        })().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) })).finally(() => {
          busyOp = null;
        });
        break;
      }
      // Removed CATALOGIZE_MEANING handler - now part of SORT_INVALID
      case "INTEGRATE_SORTED": {
        if (busyOp) {
          sendResponse({ ok: false, error: `busy: ${busyOp}` });
          break;
        }
        busyOp = "INTEGRATE";
        integrateIntoSorted().then(
          () => sendResponse({ ok: true }),
          (e) => sendResponse({ ok: false, error: String(e) })
        ).finally(() => {
          busyOp = null;
        });
        break;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  })();
  return true;
});
async function scanAndStore(options) {
  sendPhase("SCAN", "start");
  const tree = await chrome.bookmarks.getTree();
  const urlsRaw = flattenBookmarks(tree).filter(isHttpUrl);
  const normalized = (options.liftToDomain ? urlsRaw.map(normalizeToDomainRoot) : urlsRaw.slice()).filter(Boolean);
  let uniqueUrls = options.dedupe ? dedupe(normalized) : normalized;
  const prior = await storage.getRecords() ?? {};
  const results = { ...prior };
  const now = Date.now();
  const mode = options.mode || "all";
  const staleMs = options.staleMs ?? 1e3 * 60 * 60 * 24 * 7;
  if (mode !== "all") {
    const filterSet = /* @__PURE__ */ new Set();
    for (const url of uniqueUrls) {
      const rec = results[url];
      if (!rec && (mode === "missing" || mode === "resume")) {
        filterSet.add(url);
        continue;
      }
      if (rec && mode === "errors" && !rec.ok) {
        filterSet.add(url);
        continue;
      }
      if (rec && mode === "stale" && now - rec.lastFetchedAt > staleMs) {
        filterSet.add(url);
        continue;
      }
    }
    if (mode === "resume") {
      const missing = uniqueUrls.filter((u) => !results[u]);
      const errors = uniqueUrls.filter((u) => results[u] && !results[u].ok);
      const stale = uniqueUrls.filter((u) => results[u] && now - results[u].lastFetchedAt > staleMs);
      uniqueUrls = dedupe([...missing, ...errors, ...stale]);
    } else {
      uniqueUrls = uniqueUrls.filter((u) => filterSet.has(u));
    }
  }
  if (options.limit && options.limit > 0) uniqueUrls = uniqueUrls.slice(0, options.limit);
  let completed = 0;
  const total = uniqueUrls.length;
  scanState = {
    inProgress: true,
    paused: false,
    options,
    remainingQueue: uniqueUrls.slice(),
    totalPlanned: total,
    startedAt: now
  };
  let sinceLastFlush = 0;
  const flush = async (force = false) => {
    if (!force && sinceLastFlush < 25) return;
    await storage.setRecords(results);
    sinceLastFlush = 0;
    sendSnapshot(completed, total);
  };
  await processInBatches(uniqueUrls, options.parallel, async (url) => {
    if (scanState?.paused) {
      await new Promise((resolve) => {
        resumeResolver = resolve;
      });
    }
    try {
      const res = await fetchWithTimeout(url, options.timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const { title, description } = parseHtmlMeta(html);
      const tags = extractTags(`${title} ${description}`);
      const category = categorizeRecord({ url, title, description, tags });
      const record = {
        url,
        title,
        description,
        tags,
        category,
        ok: true,
        lastFetchedAt: Date.now()
      };
      results[url] = record;
    } catch (e) {
      results[url] = {
        url,
        title: "",
        description: "",
        tags: [],
        ok: false,
        error: String(e),
        lastFetchedAt: Date.now()
      };
    } finally {
      completed += 1;
      sinceLastFlush += 1;
      if (scanState) scanState.remainingQueue.shift();
      try {
        chrome.runtime.sendMessage({ type: "PROGRESS", payload: { completed, total } }, () => void chrome.runtime.lastError);
      } catch {
      }
      if (sinceLastFlush >= 25) await flush();
    }
  });
  await storage.setRecords(results);
  sendStatus(`scan completed: ${completed}/${total}`);
  sendSnapshot(completed, total);
  sendDone("SCAN");
  scanState = null;
}
async function processInBatches(items, parallel, worker) {
  const queue = items.slice();
  const runners = [];
  const run = async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  };
  const n = Math.max(1, Math.min(parallel || 1, 16));
  for (let i = 0; i < n; i++) runners.push(run());
  await Promise.all(runners);
}
function findNodeById(nodes, id) {
  const stack = [...nodes];
  while (stack.length) {
    const n = stack.pop();
    if (n.id === id) return n;
    if (n.children) stack.push(...n.children);
  }
  return void 0;
}
async function getOrCreateChildFolder(parentId, title) {
  const children = await chrome.bookmarks.getChildren(parentId);
  const found = children.find((c) => !c.url && c.title === title);
  if (found) return found;
  return chrome.bookmarks.create({ parentId, title });
}
async function exportCsv() {
  const csv = await computeCsv();
  await chrome.storage.local.set({ lastCsv: csv, lastCsvUpdatedAt: Date.now() });
  try {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename: `bookmark_meta_${Date.now()}.csv`, saveAs: true });
  } catch {
  }
  return chrome.runtime.getURL("export.html");
}
async function computeCsv() {
  const records = await storage.getRecords();
  const rows = [
    ["url", "title", "description", "tags", "category", "ok", "error", "lastFetchedAt"],
    ...Object.values(records).map((r) => [
      r.url,
      r.title,
      r.description,
      r.tags.join("|"),
      r.category ?? "",
      String(r.ok),
      r.error ?? "",
      new Date(r.lastFetchedAt).toISOString()
    ])
  ];
  return rows.map((cols) => cols.map(csvEscape).join(",")).join("\n");
}
function csvEscape(val) {
  const s = (val ?? "").replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) return `"${s}"`;
  return s;
}
async function removeInvalidRecords() {
  const records = await storage.getRecords();
  const filtered = {};
  let removed = 0;
  for (const [url, rec] of Object.entries(records)) {
    if (rec.ok) filtered[url] = rec;
    else removed += 1;
  }
  await storage.setRecords(filtered);
  sendStatus(`SORT: removed invalid \u2014 ${removed}`);
}
async function catalogizeFlat(opts) {
  const records = await storage.getRecords();
  let items = Object.values(records).filter((r) => r.ok);
  if (opts.applyLift) items = items.map((r) => ({ ...r, url: normalizeToDomainRoot(r.url) }));
  if (opts.applyDedupe) {
    const seen = /* @__PURE__ */ new Set();
    items = items.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  }
  const root = await getOrCreateSortedFolder();
  const existing = await chrome.bookmarks.getChildren(root.id);
  const existingUrls = new Set(existing.map((b) => b.url).filter(Boolean));
  let created = 0;
  for (const r of items) {
    if (existingUrls.has(r.url)) continue;
    await chrome.bookmarks.create({ parentId: root.id, title: r.title || r.url, url: r.url });
    created += 1;
  }
  sendStatus(`SORT(flat): added ${created} links under SORTED`);
  try {
    const title = `CSV Export (SORTED) ${(/* @__PURE__ */ new Date()).toLocaleString()}`;
    await saveCsvAndBookmark(root.id, title);
  } catch {
  }
}
async function mirrorOriginalStructure(opts) {
  const tree = await chrome.bookmarks.getTree();
  const records = await storage.getRecords();
  const okSet = new Set(Object.values(records).filter((r) => r.ok).map((r) => r.url));
  const rootSorted = await getOrCreateSortedFolder();
  const structureRoot = await getOrCreateChildFolder(rootSorted.id, "STRUCTURE");
  const folderCache = /* @__PURE__ */ new Map();
  const existingCache = /* @__PURE__ */ new Map();
  const globalSeen = /* @__PURE__ */ new Set();
  const walk = async (node, path) => {
    if (node.url) {
      const originalUrl = node.url;
      if (!okSet.has(originalUrl)) return;
      const targetUrl = opts.applyLift ? normalizeToDomainRoot(originalUrl) : originalUrl;
      if (opts.applyDedupe && globalSeen.has(targetUrl)) return;
      globalSeen.add(targetUrl);
      const folderPath = path.join("/");
      let folder = folderCache.get(folderPath);
      if (!folder) {
        if (path.length > 0) {
          let currentParent = structureRoot;
          for (const segment of path) {
            const children = await chrome.bookmarks.getChildren(currentParent.id);
            let childFolder = children.find((c) => !c.url && c.title === segment);
            if (!childFolder) {
              childFolder = await chrome.bookmarks.create({ parentId: currentParent.id, title: segment });
            }
            currentParent = childFolder;
          }
          folder = currentParent;
        } else {
          folder = structureRoot;
        }
        folderCache.set(folderPath, folder);
      }
      let existing = existingCache.get(folder.id);
      if (!existing) {
        const children = await chrome.bookmarks.getChildren(folder.id);
        existing = new Set(children.map((c) => c.url).filter(Boolean));
        existingCache.set(folder.id, existing);
      }
      if (existing.has(targetUrl)) return;
      await chrome.bookmarks.create({ parentId: folder.id, title: node.title || targetUrl, url: targetUrl });
      existing.add(targetUrl);
      return;
    }
    if (node.children) {
      const nextPath = node.title ? [...path, node.title] : path;
      for (const ch of node.children) await walk(ch, nextPath);
    }
  };
  for (const root of tree) await walk(root, []);
  sendStatus("STRUCTURE mirror updated under SORTED/STRUCTURE");
}
async function catalogizeByMeaningTop8() {
  const records = await storage.getRecords();
  const okItems = Object.values(records).filter((r) => r.ok);
  const h = buildTagHierarchy(okItems, { maxLevel1: 7, maxLevel2: 1, maxLevel3: 1, minCount: 2 });
  const top7 = h.level1;
  const root = await getOrCreateSortedFolder();
  const otherRoot = await getOrCreateChildFolder(root.id, "Other");
  const topFolders = /* @__PURE__ */ new Map();
  for (const t of top7) {
    const f = await getOrCreateChildFolder(root.id, t);
    topFolders.set(t, f);
  }
  const existingCache = /* @__PURE__ */ new Map();
  const getExistingSet = async (folderId) => {
    let set = existingCache.get(folderId);
    if (!set) {
      const ch = await chrome.bookmarks.getChildren(folderId);
      set = new Set(ch.map((c) => c.url).filter(Boolean));
      existingCache.set(folderId, set);
    }
    return set;
  };
  let created = 0;
  for (const r of okItems) {
    let bestTag = null;
    for (const tag of r.tags) {
      if (top7.includes(tag)) {
        bestTag = tag;
        break;
      }
    }
    const targetFolder = bestTag ? topFolders.get(bestTag) : otherRoot;
    const existing = await getExistingSet(targetFolder.id);
    if (existing.has(r.url)) continue;
    await chrome.bookmarks.create({ parentId: targetFolder.id, title: r.title || r.url, url: r.url });
    existing.add(r.url);
    created += 1;
  }
  sendStatus(`SORTED: added ${created} links (Top7 + Other, flat)`);
  try {
    const title = `CSV Export (SORTED) ${(/* @__PURE__ */ new Date()).toLocaleString()}`;
    await saveCsvAndBookmark(root.id, title);
  } catch {
  }
}
function sendStatus(text) {
  try {
    chrome.runtime.sendMessage({ type: "STATUS", payload: { text } }, () => void chrome.runtime.lastError);
  } catch {
  }
}
function sendPhase(name, step) {
  try {
    chrome.runtime.sendMessage({ type: "PHASE", payload: { name, step } }, () => void chrome.runtime.lastError);
  } catch {
  }
}
function sendDone(name) {
  try {
    chrome.runtime.sendMessage({ type: "DONE", payload: { name } }, () => void chrome.runtime.lastError);
  } catch {
  }
}
function sendSnapshot(completed, total) {
  try {
    chrome.runtime.sendMessage({ type: "SNAPSHOT", payload: { completed, total } }, () => void chrome.runtime.lastError);
  } catch {
  }
}
async function integrateIntoSorted() {
  sendPhase("INTEGRATE_SORTED", "start");
  const records = await storage.getRecords();
  const okItems = Object.values(records).filter((r) => r.ok);
  const root = await getOrCreateSortedFolder();
  const catToRecs = /* @__PURE__ */ new Map();
  for (const r of okItems) {
    const key = r.category || "Misc";
    const arr = catToRecs.get(key) ?? [];
    arr.push(r);
    catToRecs.set(key, arr);
  }
  const rankedCats = Array.from(catToRecs.entries()).sort((a, b) => b[1].length - a[1].length);
  const topCats = rankedCats.slice(0, 12).map(([c]) => c);
  const others = rankedCats.slice(12).map(([c]) => c);
  let created = 0;
  for (const cat of topCats) {
    const recs = catToRecs.get(cat);
    const folder = await getOrCreateChildFolder(root.id, cat);
    const existing = await chrome.bookmarks.getChildren(folder.id);
    const existingUrls = new Set(existing.map((b) => b.url).filter(Boolean));
    for (const r of recs) {
      if (existingUrls.has(r.url)) continue;
      await chrome.bookmarks.create({ parentId: folder.id, title: r.title || r.url, url: r.url });
      created += 1;
    }
  }
  if (others.length) {
    const otherRoot = await getOrCreateChildFolder(root.id, "Other");
    for (const cat of others) {
      const recs = catToRecs.get(cat);
      const sub = await getOrCreateChildFolder(otherRoot.id, cat);
      const existing = await chrome.bookmarks.getChildren(sub.id);
      const existingUrls = new Set(existing.map((b) => b.url).filter(Boolean));
      for (const r of recs) {
        if (existingUrls.has(r.url)) continue;
        await chrome.bookmarks.create({ parentId: sub.id, title: r.title || r.url, url: r.url });
        created += 1;
      }
    }
  }
  sendStatus(`SORTED: added ${created} links (top ${topCats.length} first-level, ${others.length} in Other)`);
  try {
    const title = `CSV Export (SORTED) ${(/* @__PURE__ */ new Date()).toLocaleString()}`;
    await saveCsvAndBookmark(root.id, title);
  } catch {
  }
  sendDone("INTEGRATE_SORTED");
}
async function getOrCreateSortedFolder() {
  const search = await chrome.bookmarks.search({ title: "SORTED" });
  const found = search.find((n) => !n.url && n.title === "SORTED");
  if (found) return found;
  const tree = await chrome.bookmarks.getTree();
  const bar = findNodeById(tree, "1");
  const parentId = bar?.id || tree[0].id;
  return chrome.bookmarks.create({ parentId, title: "SORTED" });
}
async function saveCsvAndBookmark(parentFolderId, title) {
  const csv = await computeCsv();
  await chrome.storage.local.set({ lastCsv: csv, lastCsvUpdatedAt: Date.now() });
  const url = chrome.runtime.getURL("export.html");
  const children = await chrome.bookmarks.getChildren(parentFolderId);
  const existing = children.find((c) => c.url === url || c.title.startsWith("CSV Export"));
  if (existing) {
    await chrome.bookmarks.update(existing.id, { title, url });
  } else {
    await chrome.bookmarks.create({ parentId: parentFolderId, title, url });
  }
}
