# Recall — your private, offline second memory

Dump anything in — links, screenshots, PDFs, text, voice notes. No folders, no
tags, no organization. Find it later by describing it in plain language.
**Everything stays on this device.**

- **Zero-friction capture** — type/paste/drop/record, or share from any Android
  app (Web Share Target). Saving is never blocked by processing.
- **On-device processing** — date & deadline detection, urgency scoring,
  keyword/semantic embeddings, threads, duplicate detection — all local.
  Optional intelligence packs (OCR, transcription, semantic search) download
  once and then work offline.
- **Hybrid search** — meaning + keywords + time, e.g. *"that laptop fixing
  article"* or *"when I saved the Tokyo stuff"*.
- **Passive resurfacing** — detected deadlines surface themselves; sparse by
  design, never gamified.
- **Honest confidence** — every extracted date/urgency/category carries a
  High/Medium/Low confidence label. Nothing is presented as fact.
- **Full data control** — export everything (JSON), delete everything, memory
  boundaries ("never process"), storage budget with per-type breakdown.

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
