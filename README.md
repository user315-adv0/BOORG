# BOORG — Bookmark Organizer and Metadata Scanner

Minimal, fast Chrome MV3 extension that scans your bookmarks, fetches page metadata, extracts tags, and helps you organize links under a single `SORTED` folder.

## Features

- Scan all bookmarks and fetch title/description with timeouts and parallelism
- Basic tag extraction and lightweight rule-based categorization
- One-click Sort: remove invalid links, optionally split into folders under `SORTED`
- Flat mode: put everything directly under `SORTED` (no subfolders)
- Optional CSV export (and a built-in export page)
- Pause/Resume during scanning

## Install (Unpacked)

1. Prerequisites: Node 18+ and npm
2. Install deps:
   ```bash
   npm install
   ```
3. Build:
   ```bash
   npm run build
   ```
4. In Chrome, open `chrome://extensions`, enable Developer Mode, click "Load unpacked" and select the `dist/` folder

## Usage

1. Open the extension popup
2. (Optional) Open Settings (gear icon) and adjust options
3. Click "Scan" to fetch metadata for your bookmarks
4. Click "Sort" to remove invalid and organize valid links under `Bookmarks Bar/SORTED`
   - If "Split into folders" is on: links are placed into a hierarchical structure
   - If "Flat mode" is on: all links go directly under `SORTED`
5. Click "Integrate" to re-integrate current records into `SORTED` (e.g. after tweaks)
6. Click "Export" to download CSV (or open the export page)

## Settings

- Simplify deep links to domain root: normalize URLs to `https://host/` before scanning
- Remove duplicates: deduplicate URLs before processing
- Split into folders: when sorting, create a structured hierarchy under `SORTED`
- Flat mode: if enabled, put all links directly in `SORTED` (no nested folders)

## CSV Columns

`url, title, description, tags, category, ok, error, lastFetchedAt`

## Permissions

- `bookmarks`: read and write bookmark folders
- `storage`: persist options and records
- `downloads`: optional CSV download convenience
- `host_permissions: <all_urls>`: fetch page metadata across sites

## Tech

- MV3 Service Worker background (ES Modules)
- TypeScript + esbuild
- Minimal DOM popup UI (no frameworks)

## Development

- Rebuild on changes:
  ```bash
  npm run dev
  ```
  Reload the extension in `chrome://extensions` after builds

---

This is a minimal, pragmatic tool — no external services, no heavy dependencies.


