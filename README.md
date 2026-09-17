# Recall — your private, offline second memory

Dump anything in — links, screenshots, PDFs, text, voice notes. No folders, no
tags, no organization. Find it later by describing it in plain language.
**Everything stays on this device.**

- **Zero-friction capture** — type/paste/drop/record, or share from any Android
  app (Web Share Target). Saving is never blocked by processing.
- **Non-blocking background processing (V3)** — every enrichment step runs in
  a pool of Web Workers: the UI (capture, search, browsing) stays fully
  responsive even while OCR or transcription is running. A priority queue
  guarantees quick text jobs (dates, urgency, keyword indexing) always run
  before heavy model jobs, no matter which was queued first — and jobs for
  different fragments execute concurrently.
- **On-device processing** — date & deadline detection, urgency scoring,
  keyword/semantic embeddings, threads, duplicate detection — all local.
  Optional intelligence packs (OCR, transcription, semantic search) download
  once and then work offline.
- **Hybrid search** — meaning + keywords + time, e.g. *"that laptop fixing
  article"* or *"when I saved the Tokyo stuff"*. Query embeddings run through
  a worker fast lane so search never waits behind background jobs.
- **Passive resurfacing** — detected deadlines surface themselves; sparse by
  design, never gamified.
- **Honest confidence** — every extracted date/urgency/category carries a
  High/Medium/Low confidence label. Nothing is presented as fact.
- **Full data control** — export everything (JSON), delete everything, memory
  boundaries ("never process"), storage budget with per-type breakdown.

## Processing architecture (V3)

```
capture ──▶ IndexedDB (saved instantly, searchable immediately)
                │
                └─▶ priority job queue (per-fragment steps, crash-recoverable)
                          │
        ┌─────────────────┴──────────────────┐
   light lane (always first)          heavy lane (capped 1–2 at a time)
   dates · urgency · category          OCR (tesseract.js)
   lexical embed · dedupe · threads    transcription (whisper)
   ────────────────────────            PDF text (pdf.js)
   Web Worker pool (2–4 workers)       semantic embeddings (MiniLM)
```

- **Off the UI thread**: all compute — including the model packs — runs inside
  `src/lib/workers/processing.worker.ts` (module worker). The main thread only
  orchestrates and writes results to IndexedDB. Nested model workers
  (tesseract, pdf.js) are re-served from same-origin blob URLs because
  browsers reject cross-origin worker scripts.
- **Priority, not FIFO**: the scheduler always dispatches light work first,
  so a screenshot OCR queued earlier can never delay the date extraction of a
  plain note captured later. Heavy jobs are capped (memory safety) but never
  block light ones — workers are dedicated per lane.
- **Independent execution**: at most one job per fragment at a time (keeps a
  fragment's steps ordered), while jobs for *different* fragments run
  concurrently across the pool.
- **Save-first is untouched**: fragments are persisted and searchable before
  any enrichment runs; failed/skipped jobs never block a fragment.
- Tap the thin "N quick · M heavy in background" indicator (bottom nav strip
  or the header button) to see the live queue: running jobs, both lanes, and
  recent completions.

## Tech

Next.js 16 (App Router, static export) · TypeScript · Tailwind CSS 4 ·
IndexedDB (Dexie) · vanilla service worker. No backend, no accounts, no cloud.

## Develop locally

```bash
bun install
bun run dev        # http://localhost:3000
```

## Build & deploy (GitHub Pages)

The app is a **fully static export** — no server required.

1. Push this repo to GitHub (branch `main`).
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and publishes
   on every push to `main`. That's it — the PWA is served from
   `https://<user>.github.io/<repo>/`.

The build reads `NEXT_PUBLIC_BASE_PATH` to generate subpath-correct URLs
(assets, manifest, service worker scope, share-target). The workflow sets it
automatically to `/<repo>`.

### Building manually

```bash
# project page (https://user.github.io/<repo>/)
NEXT_PUBLIC_BASE_PATH=/recall bun run build          # → static site in out/

# root page or custom domain — no base path
bun run build                                       # → static site in out/

# preview the export locally
npx serve out
```

Deploy any way you like (the `out/` folder is plain static hosting):
GitHub Actions (included), `npx gh-pages -d out`, Netlify, Cloudflare Pages…

### Manual GitHub Pages deployment (without Actions)

```bash
NEXT_PUBLIC_BASE_PATH=/<repo> bun run build
touch out/.nojekyll          # keep GitHub's Jekyll away from _next/
npx gh-pages -d out -t true
```

## Capacitor roadmap

The codebase is Capacitor-ready: browser-only APIs are isolated, the share
inbox DB contract is stable, and notification handling is behind a thin
adapter. The native phase adds reliable background resurfacing, local
notifications, and a home-screen widget.

## Privacy

There is no server. The only network use is the one-time download of optional
intelligence packs (models) from public CDNs — after that, everything runs
offline on your device. Use Settings → Data to export or wipe at any time.
