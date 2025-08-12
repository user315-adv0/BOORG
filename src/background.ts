import { flattenBookmarks, fetchWithTimeout, parseHtmlMeta, extractTags, normalizeToDomainRoot, dedupe, isHttpUrl, categorizeRecord, buildTagHierarchy, assignHierarchyPath } from "./utils";
import { Storage } from "./storage";
import type { ScanOptions, LinkRecord, RecordsMap, BgMessage, PopupMessage, ScanState } from "./types";

const DEFAULT_OPTIONS: ScanOptions = {
  liftToDomain: false,
  timeoutMs: 8000,
  parallel: 6,
  splitIntoFolders: true,
    flatMode: false,
};

const storage = new Storage();

let scanState: ScanState | null = null;
let resumeResolver: (() => void) | null = null;
let busyOp: string | null = null;

// Optional: accept keep-alive connections from popup
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keep-alive") return;
  port.onMessage.addListener((_msg) => {
    // noop; the existence of the port keeps SW alive while popup is open
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  const { options } = await storage.getAll();
  if (!options) await storage.setOptions(DEFAULT_OPTIONS);
});

chrome.runtime.onMessage.addListener((msg: PopupMessage, _sender, sendResponse) => {
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
        if (busyOp) { sendResponse({ ok: false, error: `busy: ${busyOp}` }); break; }
        const merged = { ...(await storage.getOptionsOrDefault(DEFAULT_OPTIONS)), ...(msg.payload ?? {}) };
        // respond immediately; progress will be emitted via events
        sendResponse({ ok: true });
        busyOp = "SCAN";
        scanAndStore(merged).catch((e) => sendStatus(`scan error: ${String(e)}`)).finally(() => { busyOp = null; });
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
            const r = resumeResolver; resumeResolver = null; r();
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
        if (busyOp) { sendResponse({ ok: false, error: `busy: ${busyOp}` }); break; }
        // Phase 1: drop invalid, Phase 2: catalogize by meaning
        busyOp = "SORT";
        (async () => {
          sendPhase("SORT", "start");
          await removeInvalidRecords();
          const opts = await storage.getOptionsOrDefault(DEFAULT_OPTIONS);
          // Flat mode dominates: place everything flat under SORTED
          if (opts.flatMode) {
            await catalogizeFlat({ applyLift: !!opts.liftToDomain, applyDedupe: !!opts.dedupe });
          } else {
            // 3) Tag-based categorization (Top7 + Other) - if enabled, skip STRUCTURE
            if (opts.splitIntoFolders) {
              await catalogizeByMeaningTop8();
            } else {
              // 1) Mirror original structure (apply lift/dedupe if requested) - only if no categorization
              if (opts.liftToDomain || opts.dedupe) {
                await mirrorOriginalStructure({ applyLift: !!opts.liftToDomain, applyDedupe: !!opts.dedupe });
              } else {
                sendStatus("No organization selected - only invalid links removed");
              }
            }
          }
          sendDone("SORT");
        })()
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: String(e) }))
          .finally(() => { busyOp = null; });
        break;
      }
      // Removed CATALOGIZE_MEANING handler - now part of SORT_INVALID
      case "INTEGRATE_SORTED": {
        if (busyOp) { sendResponse({ ok: false, error: `busy: ${busyOp}` }); break; }
        busyOp = "INTEGRATE";
        integrateIntoSorted().then(
          () => sendResponse({ ok: true }),
          (e) => sendResponse({ ok: false, error: String(e) })
        ).finally(() => { busyOp = null; });
        break;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message" });
    }
  })();
  return true; // keep message channel open
});

async function scanAndStore(options: ScanOptions) {
  sendPhase("SCAN", "start");
  const tree = await chrome.bookmarks.getTree();
  const urlsRaw = flattenBookmarks(tree).filter(isHttpUrl);
  const normalized = (options.liftToDomain ? urlsRaw.map(normalizeToDomainRoot) : urlsRaw.slice()).filter(Boolean) as string[];
  let uniqueUrls = options.dedupe ? dedupe(normalized) : normalized;

  const prior: RecordsMap = (await storage.getRecords()) ?? {};
  const results: RecordsMap = { ...prior };

  // choose subset based on mode
  const now = Date.now();
  const mode = options.mode || "all";
  const staleMs = options.staleMs ?? 1000 * 60 * 60 * 24 * 7; // 7d default
  if (mode !== "all") {
    const filterSet = new Set<string>();
    for (const url of uniqueUrls) {
      const rec = results[url];
      if (!rec && (mode === "missing" || mode === "resume")) { filterSet.add(url); continue; }
      if (rec && mode === "errors" && !rec.ok) { filterSet.add(url); continue; }
      if (rec && mode === "stale" && now - rec.lastFetchedAt > staleMs) { filterSet.add(url); continue; }
    }
    // resume: prefer those without records, otherwise errors, then stale
    if (mode === "resume") {
      const missing = uniqueUrls.filter(u => !results[u]);
      const errors = uniqueUrls.filter(u => results[u] && !results[u].ok);
      const stale = uniqueUrls.filter(u => results[u] && now - results[u].lastFetchedAt > staleMs);
      uniqueUrls = dedupe([...missing, ...errors, ...stale]);
    } else {
      uniqueUrls = uniqueUrls.filter(u => filterSet.has(u));
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
    startedAt: now,
  };
  let sinceLastFlush = 0;
  const flush = async (force = false) => {
    if (!force && sinceLastFlush < 25) return;
    await storage.setRecords(results);
    sinceLastFlush = 0;
    // quiet checkpoint
    sendSnapshot(completed, total);
  };

  await processInBatches(uniqueUrls, options.parallel, async (url) => {
    // pause support
    if (scanState?.paused) {
      await new Promise<void>((resolve) => { resumeResolver = resolve; });
    }
    try {
      const res = await fetchWithTimeout(url, options.timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const { title, description } = parseHtmlMeta(html);
      const tags = extractTags(`${title} ${description}`);
      const category = categorizeRecord({ url, title, description, tags });
      const record: LinkRecord = {
        url,
        title,
        description,
        tags,
        category,
        ok: true,
        lastFetchedAt: Date.now(),
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
        lastFetchedAt: Date.now(),
      };
    } finally {
      completed += 1;
      sinceLastFlush += 1;
      if (scanState) scanState.remainingQueue.shift();
      try {
        chrome.runtime.sendMessage({ type: "PROGRESS", payload: { completed, total } } as BgMessage, () => void chrome.runtime.lastError);
      } catch {}
      if (sinceLastFlush >= 25) await flush();
    }
  });

  await storage.setRecords(results);
  sendStatus(`scan completed: ${completed}/${total}`);
  sendSnapshot(completed, total);
  sendDone("SCAN");
  scanState = null;
}

async function processInBatches<T>(items: T[], parallel: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  const runners: Promise<void>[] = [];
  const run = async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await worker(item);
    }
  };
  const n = Math.max(1, Math.min(parallel || 1, 16));
  for (let i = 0; i < n; i++) runners.push(run());
  await Promise.all(runners);
}

// Removed unused Processed folder functions

function findNodeById(nodes: chrome.bookmarks.BookmarkTreeNode[], id: string): chrome.bookmarks.BookmarkTreeNode | undefined {
  const stack = [...nodes];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    if (n.children) stack.push(...n.children);
  }
  return undefined;
}

async function getOrCreateChildFolder(parentId: string, title: string): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const children = await chrome.bookmarks.getChildren(parentId);
  const found = children.find((c) => !c.url && c.title === title);
  if (found) return found;
  return chrome.bookmarks.create({ parentId, title });
}

async function exportCsv(): Promise<string> {
  const csv = await computeCsv();
  // persist latest CSV into storage for later retrieval via export.html
  await chrome.storage.local.set({ lastCsv: csv, lastCsvUpdatedAt: Date.now() });

  // also trigger a download for convenience
  try {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename: `bookmark_meta_${Date.now()}.csv`, saveAs: true });
  } catch {
    // ignore
  }

  // return a stable internal page URL
  return chrome.runtime.getURL("export.html");
}

async function computeCsv(): Promise<string> {
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
      new Date(r.lastFetchedAt).toISOString(),
    ]),
  ];
  return rows.map((cols) => cols.map(csvEscape).join(",")).join("\n");
}

function csvEscape(val: string): string {
  const s = (val ?? "").replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) return `"${s}"`;
  return s;
}

async function removeInvalidRecords(): Promise<void> {
  const records = await storage.getRecords();
  const filtered: RecordsMap = {};
  let removed = 0;
  for (const [url, rec] of Object.entries(records)) {
    if (rec.ok) filtered[url] = rec; else removed += 1;
  }
  await storage.setRecords(filtered);
  sendStatus(`SORT: removed invalid — ${removed}`);
}

// Removed catalogizeByMeaning - replaced by catalogizeByMeaningTop8

async function catalogizeFlat(opts: { applyLift: boolean; applyDedupe: boolean }): Promise<void> {
  const records = await storage.getRecords();
  let items = Object.values(records).filter((r) => r.ok);
  if (opts.applyLift) items = items.map((r) => ({ ...r, url: normalizeToDomainRoot(r.url) }));
  if (opts.applyDedupe) {
    const seen = new Set<string>();
    items = items.filter((r) => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
  }
  const root = await getOrCreateSortedFolder();
  const existing = await chrome.bookmarks.getChildren(root.id);
  const existingUrls = new Set(existing.map((b) => b.url).filter(Boolean) as string[]);
  let created = 0;
  for (const r of items) {
    if (existingUrls.has(r.url)) continue;
    await chrome.bookmarks.create({ parentId: root.id, title: r.title || r.url, url: r.url });
    created += 1;
  }
  sendStatus(`SORT(flat): added ${created} links under SORTED`);
  try {
    const title = `CSV Export (SORTED) ${new Date().toLocaleString()}`;
    await saveCsvAndBookmark(root.id, title);
  } catch {}
}

async function mirrorOriginalStructure(opts: { applyLift: boolean; applyDedupe: boolean }): Promise<void> {
  // Recreate original folder hierarchy under SORTED/STRUCTURE with processed links
  const tree = await chrome.bookmarks.getTree();
  const records = await storage.getRecords();
  const okSet = new Set(Object.values(records).filter((r) => r.ok).map((r) => r.url));
  const rootSorted = await getOrCreateSortedFolder();
  const structureRoot = await getOrCreateChildFolder(rootSorted.id, "STRUCTURE");

  const folderCache = new Map<string, chrome.bookmarks.BookmarkTreeNode>(); // path -> node
  const existingCache = new Map<string, Set<string>>(); // folderId -> existingUrls
  const globalSeen = new Set<string>(); // for dedupe across whole mirror

  const walk = async (node: chrome.bookmarks.BookmarkTreeNode, path: string[]) => {
    if (node.url) {
      const originalUrl = node.url;
      if (!okSet.has(originalUrl)) return; // skip invalid
      const targetUrl = opts.applyLift ? normalizeToDomainRoot(originalUrl) : originalUrl;
      if (opts.applyDedupe && globalSeen.has(targetUrl)) return;
      globalSeen.add(targetUrl);

      // ensure path under STRUCTURE
      const folderPath = path.join("/");
      let folder = folderCache.get(folderPath);
      if (!folder) {
        // Create nested folders if path has multiple segments
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
        existing = new Set(children.map((c) => c.url).filter(Boolean) as string[]);
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

async function catalogizeByMeaningTop8(): Promise<void> {
  // Build Top-7 tags + Other, then place records up to 3 levels deep
  const records = await storage.getRecords();
  const okItems = Object.values(records).filter((r) => r.ok);
  const h = buildTagHierarchy(okItems, { maxLevel1: 7, maxLevel2: 1, maxLevel3: 1, minCount: 2 });
  const top7 = h.level1; // already limited to 7
  const root = await getOrCreateSortedFolder();
  const otherRoot = await getOrCreateChildFolder(root.id, "Other");

  // Pre-create top category folders
  const topFolders = new Map<string, chrome.bookmarks.BookmarkTreeNode>();
  for (const t of top7) {
    const f = await getOrCreateChildFolder(root.id, t);
    topFolders.set(t, f);
  }

  // Cache existing urls per folder to avoid duplicates
  const existingCache = new Map<string, Set<string>>();
  const getExistingSet = async (folderId: string) => {
    let set = existingCache.get(folderId);
    if (!set) {
      const ch = await chrome.bookmarks.getChildren(folderId);
      set = new Set(ch.map((c) => c.url).filter(Boolean) as string[]);
      existingCache.set(folderId, set);
    }
    return set;
  };

  let created = 0;
  for (const r of okItems) {
    // Simple: find best matching top tag, or put in Other
    let bestTag: string | null = null;
    for (const tag of r.tags) {
      if (top7.includes(tag)) {
        bestTag = tag;
        break;
      }
    }
    const targetFolder = bestTag ? topFolders.get(bestTag)! : otherRoot;
    const existing = await getExistingSet(targetFolder.id);
    if (existing.has(r.url)) continue;
    await chrome.bookmarks.create({ parentId: targetFolder.id, title: r.title || r.url, url: r.url });
    existing.add(r.url);
    created += 1;
  }
  sendStatus(`SORTED: added ${created} links (Top7 + Other, flat)`);
  try {
    const title = `CSV Export (SORTED) ${new Date().toLocaleString()}`;
    await saveCsvAndBookmark(root.id, title);
  } catch {}
}

// removed Topics root in favor of single 'SORTED' root

// Removed ensureNestedFolders - no longer needed

// removed duplicate safeHostname (exists in utils)

function sendStatus(text: string) {
  try { chrome.runtime.sendMessage({ type: "STATUS", payload: { text } } as BgMessage, () => void chrome.runtime.lastError); } catch {}
}
function sendPhase(name: string, step?: string) {
  try { chrome.runtime.sendMessage({ type: "PHASE", payload: { name, step } } as BgMessage, () => void chrome.runtime.lastError); } catch {}
}
function sendDone(name: string) {
  try { chrome.runtime.sendMessage({ type: "DONE", payload: { name } } as BgMessage, () => void chrome.runtime.lastError); } catch {}
}
function sendSnapshot(completed: number, total: number) {
  try { chrome.runtime.sendMessage({ type: "SNAPSHOT", payload: { completed, total } } as BgMessage, () => void chrome.runtime.lastError); } catch {}
}

async function integrateIntoSorted(): Promise<void> {
  sendPhase("INTEGRATE_SORTED", "start");
  const records = await storage.getRecords();
  const okItems = Object.values(records).filter(r => r.ok);
  const root = await getOrCreateSortedFolder();

  // Group by category
  const catToRecs = new Map<string, LinkRecord[]>();
  for (const r of okItems) {
    const key = r.category || "Misc";
    const arr = catToRecs.get(key) ?? [];
    arr.push(r); catToRecs.set(key, arr);
  }

  // Rank categories by frequency and keep only top 12 at the first level
  const rankedCats = Array.from(catToRecs.entries()).sort((a,b) => b[1].length - a[1].length);
  const topCats = rankedCats.slice(0, 12).map(([c]) => c);
  const others = rankedCats.slice(12).map(([c]) => c);

  let created = 0;

  // Place top categories on first level
  for (const cat of topCats) {
    const recs = catToRecs.get(cat)!;
    const folder = await getOrCreateChildFolder(root.id, cat);
    const existing = await chrome.bookmarks.getChildren(folder.id);
    const existingUrls = new Set(existing.map((b) => b.url).filter(Boolean) as string[]);
    for (const r of recs) {
      if (existingUrls.has(r.url)) continue;
      await chrome.bookmarks.create({ parentId: folder.id, title: r.title || r.url, url: r.url });
      created += 1;
    }
  }

  // Place remaining categories under "Other"
  if (others.length) {
    const otherRoot = await getOrCreateChildFolder(root.id, "Other");
    for (const cat of others) {
      const recs = catToRecs.get(cat)!;
      const sub = await getOrCreateChildFolder(otherRoot.id, cat);
      const existing = await chrome.bookmarks.getChildren(sub.id);
      const existingUrls = new Set(existing.map((b) => b.url).filter(Boolean) as string[]);
      for (const r of recs) {
        if (existingUrls.has(r.url)) continue;
        await chrome.bookmarks.create({ parentId: sub.id, title: r.title || r.url, url: r.url });
        created += 1;
      }
    }
  }

  sendStatus(`SORTED: added ${created} links (top ${topCats.length} first-level, ${others.length} in Other)`);
  // add/update CSV link in root
  try {
    const title = `CSV Export (SORTED) ${new Date().toLocaleString()}`;
    await saveCsvAndBookmark(root.id, title);
  } catch {}
  sendDone("INTEGRATE_SORTED");
}

async function getOrCreateSortedFolder(): Promise<chrome.bookmarks.BookmarkTreeNode> {
  const search = await chrome.bookmarks.search({ title: "SORTED" });
  const found = search.find((n) => !n.url && n.title === "SORTED");
  if (found) return found;
  const tree = await chrome.bookmarks.getTree();
  const bar = findNodeById(tree, "1");
  const parentId = bar?.id || tree[0].id;
  return chrome.bookmarks.create({ parentId, title: "SORTED" });
}

async function saveCsvAndBookmark(parentFolderId: string, title: string): Promise<void> {
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


