# Recall — deliverables

## The app

A privacy-first, offline PWA acting as your external memory. This folder holds
preview screenshots; the app itself is the Next.js project in the repo root.

- `recall-mobile.png` — mobile, light theme (bottom nav + dominant capture bar)
- `recall-mobile-dark.png` — mobile, dark theme (warm espresso)
- `recall-desktop.png` — desktop, light theme (sidebar nav, wide viewports)
- `queue-sheet-v3.png` — the "background processing" drawer: live lanes,
  running jobs, pool info
- `recall-home-v3.png` — home feed after the V3 processing-queue overhaul

## V2 additions (this iteration)

**UI / visual overhaul — mobile-first, personal, calm**

- Navigation: bottom nav bar on mobile (Home · Today · Search · Threads ·
  Settings, thumb-reachable, safe-area aware); the left sidebar now appears
  only on wide desktop viewports. The old mobile type-drawer was replaced by
  a scrollable lens-chip row on Home (Everything / Deadlines / Meetings /
  Links / PDFs / Screenshots / Voice / Text / Processing).
- Capture bar is the visual hero: coral gradient card with soft glow, larger
  input, pill Save button, round attach buttons (photo / file / voice).
- Themes: light (warm ivory) + dark (warm espresso), system auto-detect by
  default, manual override in Settings → Appearance and a quick cycle toggle
  in the top bar. Applied pre-paint (no flash), persisted on-device.
- Personality: persimmon-coral accent + ivory/espresso surfaces, Fraunces
  display serif paired with Nunito Sans — no default grays, no amber kit look.
- Calm components: confidence is shown as soft sage/apricot pills
  (“Possible deadline … medium confidence”), resurfaced cards and empty
  states use rounded shapes and friendly copy — nothing looks like an alert
  unless it's genuinely urgent.
- Touch ergonomics: 44px+ targets, primary actions low on screen, and
  swipe gestures on resurfaced cards — swipe right = "got it", swipe left =
  snooze (buttons remain for accessibility).

**Hosting — GitHub Pages ready**

- `output: 'export'` static build; no server needed.
- Subpath-safe: all asset paths, the manifest (`start_url`/`scope`/icons/
  share-target) and the service worker resolve relative to the deployment
  base via `NEXT_PUBLIC_BASE_PATH`.
- `.github/workflows/deploy.yml` — GitHub Actions that installs, builds with
  the correct base path and publishes to GitHub Pages (Settings → Pages →
  Source: GitHub Actions is the only manual step).
- `public/.nojekyll` keeps GitHub's Jekyll away from the `_next/` folder.
- README.md documents manual build/deploy alternatives.

## Verification (this iteration)

- ESLint clean; TypeScript clean for app code.
- Browser end-to-end on the dev build: setup wizard, seeding, lens chips,
  live capture with date detection (“Pay the electricity bill by Friday
  5pm” → deadline detected, auto-resurfaced), search idle view + example
  chips, threads, settings appearance (System/Light/Dark radios), theme
  toggle persistence across reloads, desktop sidebar visibility rules.
- Static export built with `NEXT_PUBLIC_BASE_PATH=/recall`, served at a
  `/recall/` subpath: page, manifest, service worker scope and all 14
  assets resolve under the base; full app flow re-verified on the export.
- Offline test on the export: network cut, full reload served entirely from
  the service worker cache with all data intact.

## V3 fix — processing queue (this iteration)

**Off the main thread** — all enrichment compute (dates, urgency, category,
lexical + semantic embeddings, OCR, transcription, PDF text, perceptual
hashing, thread clustering) now runs inside a pool of 2–4 module Web Workers
(`src/lib/workers/processing.worker.ts`). The main thread only orchestrates
and writes to IndexedDB; capture, search and browsing stay fully responsive
even while OCR/whisper inference is running.

**Priority lanes, not FIFO** — quick text jobs (date/urgency extraction on a
plain note) are always dispatched before heavy model jobs (OCR, voice, PDF,
semantic embeddings), regardless of which was queued first. Heavy jobs are
capped at 1–2 concurrent; light jobs always keep workers free. A per-fragment
mutex keeps each fragment's steps ordered while different fragments process
concurrently.

**Model packs live inside the worker** — transformers.js, tesseract.js and
pdf.js load and run in the worker; downloads happen once and are cached for
offline use. Nested model workers are re-served from same-origin blob URLs
(browsers reject cross-origin worker scripts).

**Visible queue** — tap "N quick · M heavy in background" (bottom-nav strip
or header button) to see running jobs, both lanes with waiting counts, and
recent completions. See `queue-sheet-v3.png`.

**Verification** — real end-to-end races: a screenshot OCR (heavy) and a
text note captured moments later processed concurrently, with the note
reaching "ready" while the image was still in the heavy lane — captured in
job-level polling and in the queue drawer. Real OCR verified on generated
text-bearing images (dates and urgency extracted from the OCR'd text);
semantic search verified through the worker query fast lane. The static
export was re-verified at a `/recall/` subpath including a full offline pass
(app shell + data + worker processing with zero network).
