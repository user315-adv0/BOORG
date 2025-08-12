import type { HtmlMeta } from "./types";

export function flattenBookmarks(nodes: chrome.bookmarks.BookmarkTreeNode[]): string[] {
  const urls: string[] = [];
  const walk = (n: chrome.bookmarks.BookmarkTreeNode) => {
    if (n.url) urls.push(n.url);
    if (n.children) n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return urls;
}

export function isHttpUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeToDomainRoot(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.hostname}/`;
  } catch {
    return urlStr;
  }
}

export function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}

export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

export function parseHtmlMeta(html: string): HtmlMeta {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = cleanupText(titleMatch?.[1] ?? "");
  const desc = matchMeta(html, "description") || matchOg(html, "description") || "";
  return { title, description: cleanupText(desc) };
}

function matchMeta(html: string, name: string): string | undefined {
  const re = new RegExp(`<meta[^>]+name=["']?${escapeRegex(name)}["']?[^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return;
  const content = tag.match(/content=["']([\s\S]*?)["']/i)?.[1];
  return content;
}

function matchOg(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+property=["']?og:${escapeRegex(prop)}["']?[^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return;
  const content = tag.match(/content=["']([\s\S]*?)["']/i)?.[1];
  return content;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanupText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const STOPWORDS_RU = new Set<string>([]);
const STOPWORDS_EN = new Set([
  "the","and","a","an","to","of","in","for","on","at","by","is","it","this","that","with","as","from","or","are","be","was","were","but","not","we","you","they","their","our","your","about","all","can","has","have","will","more","one","two","new","how","what","why","when","where","which","who","use","using","used","into","over","if","also","may","just"
]);

export function extractTags(text: string, maxTags = 10): string[] {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS_EN.has(w) && !STOPWORDS_RU.has(w));

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTags)
    .map(([w]) => w);
}

// Basic rule-based categorization using URL hints, tags and keywords
export function categorizeRecord(input: { url: string; title: string; description: string; tags: string[] }): string {
  const { url, title, description, tags } = input;
  const lc = `${title} ${description}`.toLowerCase();
  const hostname = safeHostname(url);

  // Domain-based hints
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

  const hasTag = (arr: string[]) => arr.some(t => tags.includes(t));

  // Keyword buckets
  const rules: Array<{ name: string; any: (string|RegExp)[] }> = [
    { name: "AI/ML", any: [/machine learning|deep learning|neural|llm|gpt|transformer|nlp|cv\b|classification|regression/i, "ml", "ai"] },
    { name: "Programming", any: ["javascript","typescript","python","go","rust","java","kotlin","php","ruby","c++","c#","swift","dart","node","react","vue","svelte","angular","next","nuxt"] },
    { name: "DevOps", any: ["docker","kubernetes","k8s","terraform","ansible","ci","cd","jenkins","github actions","monitoring","prometheus","grafana"] },
    { name: "Security", any: ["security","oauth","jwt","xss","csrf","encryption","vulnerability","penetration"] },
    { name: "Cloud", any: ["aws","gcp","azure","cloudflare","serverless","lambda","cloud run"] },
    { name: "Data", any: ["sql","postgres","mysql","mongodb","clickhouse","data warehouse","etl","airflow","spark","hadoop"] },
    { name: "Design", any: ["figma","ux","ui","design","typography","color","interface"] },
    { name: "Business", any: ["startup","marketing","product","growth","sales","pricing"] },
    { name: "Crypto", any: ["crypto","blockchain","ethereum","defi","nft"] },
    { name: "Mobile", any: ["android","ios","react native","flutter","swiftui"] },
    { name: "Testing", any: ["test","testing","jest","cypress","playwright","unit","e2e"] },
    { name: "Docs", any: ["documentation","api reference","reference","guide","manual"] },
    { name: "Research", any: ["paper","arxiv","doi","research","study"] },
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

  // Fallbacks
  if (tags.length > 0) return capitalize(tags[0]);
  if (hostname) return hostname.replace(/^www\./, "");
  return "Misc";
}

function safeHostname(url: string): string | undefined {
  try { return new URL(url).hostname; } catch { return undefined; }
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

// -------- Hierarchical tag catalogization helpers --------

export type TagHierarchy = {
  level1: string[];
  level2: Map<string, string[]>; // l1 -> sorted l2
  level3: Map<string, string[]>; // l1//l2 -> sorted l3
  docFreq: Map<string, number>;
};

export type HierarchyConfig = {
  maxLevel1: number;
  maxLevel2: number;
  maxLevel3: number;
  minCount: number;
};

export function buildTagHierarchy(
  items: { tags: string[] }[],
  config: HierarchyConfig = { maxLevel1: 12, maxLevel2: 8, maxLevel3: 6, minCount: 3 }
): TagHierarchy {
  const docFreq = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string, d = 1) => m.set(k, (m.get(k) ?? 0) + d);

  // doc frequency per tag
  for (const it of items) {
    const uniq = Array.from(new Set(it.tags));
    for (const t of uniq) inc(docFreq, t, 1);
  }

  const sortedTags = Array.from(docFreq.entries())
    .filter(([, c]) => c >= config.minCount)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
  const level1 = sortedTags.slice(0, config.maxLevel1);

  const level2 = new Map<string, string[]>();
  const level3 = new Map<string, string[]>();

  // helper to get items containing all tags
  const itemsWith = (required: string[]) =>
    items.filter((it) => required.every((t) => it.tags.includes(t)));

  for (const l1 of level1) {
    const counts2 = new Map<string, number>();
    for (const it of itemsWith([l1])) {
      for (const t of new Set(it.tags)) {
        if (t === l1) continue;
        inc(counts2, t, 1);
      }
    }
    const l2 = Array.from(counts2.entries())
      .filter(([, c]) => c >= config.minCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, config.maxLevel2)
      .map(([t]) => t);
    level2.set(l1, l2);

    for (const l2t of l2) {
      const counts3 = new Map<string, number>();
      for (const it of itemsWith([l1, l2t])) {
        for (const t of new Set(it.tags)) {
          if (t === l1 || t === l2t) continue;
          inc(counts3, t, 1);
        }
      }
      const l3 = Array.from(counts3.entries())
        .filter(([, c]) => c >= config.minCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, config.maxLevel3)
        .map(([t]) => t);
      level3.set(`${l1}//${l2t}`, l3);
    }
  }

  return { level1, level2, level3, docFreq };
}

export function assignHierarchyPath(
  record: { url: string; tags: string[] },
  h: TagHierarchy
): string[] {
  const tagsSorted = Array.from(new Set(record.tags)).sort(
    (a, b) => (h.docFreq.get(b) ?? 0) - (h.docFreq.get(a) ?? 0)
  );
  let l1: string | undefined;
  for (const t of tagsSorted) if (h.level1.includes(t)) { l1 = t; break; }
  if (!l1) return [safeHostname(record.url) ?? "Misc"]; // fallback single level

  const rest = tagsSorted.filter((t) => t !== l1);
  let l2: string | undefined;
  const l2List = h.level2.get(l1) ?? [];
  for (const t of rest) if (l2List.includes(t)) { l2 = t; break; }

  if (!l2) return [l1];

  const l3List = h.level3.get(`${l1}//${l2}`) ?? [];
  let l3: string | undefined;
  for (const t of rest) if (t !== l2 && l3List.includes(t)) { l3 = t; break; }

  return l3 ? [l1, l2, l3] : [l1, l2];
}


