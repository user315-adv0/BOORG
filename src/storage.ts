import type { RecordsMap, ScanOptions } from "./types";

export class Storage {
  async getAll(): Promise<{ options?: ScanOptions; records?: RecordsMap }> {
    return new Promise((resolve) => chrome.storage.local.get(["options", "records"], resolve));
  }

  async getOptionsOrDefault(defaults: ScanOptions): Promise<ScanOptions> {
    const { options } = await this.getAll();
    return { ...defaults, ...(options ?? {}) };
  }

  async setOptions(options: Partial<ScanOptions>): Promise<void> {
    const current = await this.getOptionsOrDefault({ liftToDomain: false, timeoutMs: 8000, parallel: 6, splitIntoFolders: true, flatMode: false });
    await chrome.storage.local.set({ options: { ...current, ...options } });
  }

  async getRecords(): Promise<RecordsMap> {
    const { records } = await this.getAll();
    return records ?? {};
  }

  async setRecords(records: RecordsMap): Promise<void> {
    await chrome.storage.local.set({ records });
  }
}


