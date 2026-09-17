# Recall — deliverables

## The app

A privacy-first, offline PWA acting as your external memory. This folder holds
preview screenshots; the app itself is the Next.js project in the repo root.

- `recall-mobile.png` — mobile, light theme (bottom nav + dominant capture bar)
- `recall-mobile-dark.png` — mobile, dark theme (warm espresso)
- `recall-desktop.png` — desktop, light theme (sidebar nav, wide viewports)

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
