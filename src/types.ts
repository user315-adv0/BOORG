export type ScanOptions = {
  liftToDomain: boolean;
  timeoutMs: number;
  parallel: number;
  splitIntoFolders?: boolean; // controls catalogization step in Sort phase
  flatMode?: boolean; // when splitting, place all links directly under SORTED
  mode?: "all" | "missing" | "errors" | "stale" | "resume";
  staleMs?: number;
  limit?: number;
  dedupe?: boolean;
};

export type ScanState = {
  inProgress: boolean;
  paused: boolean;
  options: ScanOptions;
  remainingQueue: string[];
  totalPlanned: number;
  startedAt: number;
};

export type LinkRecord = {
  url: string;
  title: string;
  description: string;
  tags: string[];
  category?: string;
  ok: boolean;
  error?: string;
  lastFetchedAt: number;
};

export type RecordsMap = Record<string, LinkRecord>;

export type HtmlMeta = {
  title: string;
  description: string;
};

export type PopupMessage =
  | { type: "GET_OPTIONS" }
  | { type: "SET_OPTIONS"; payload: Partial<ScanOptions> }
  | { type: "GET_RECORDS" }
  | { type: "CLEAR_RECORDS" }
  | { type: "SCAN_BOOKMARKS"; payload?: Partial<ScanOptions> }
  | { type: "EXPORT_CSV" }
  | { type: "SORT_INVALID" }
  | { type: "CATALOGIZE_MEANING" }
  | { type: "PAUSE_SCAN" }
  | { type: "RESUME_SCAN" }
  | { type: "INTEGRATE_SORTED" };

export type BgMessage =
  | { type: "PROGRESS"; payload: { completed: number; total: number } }
  | { type: "STATUS"; payload: { text: string } }
  | { type: "PHASE"; payload: { name: string; step?: string } }
  | { type: "DONE"; payload: { name: string } }
  | { type: "ERROR"; payload: { text: string } }
  | { type: "SNAPSHOT"; payload: { completed: number; total: number } };


