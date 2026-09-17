# Worklog

---
Task ID: 1
Agent: main (Super Z)
Task: Build "Recall" — a privacy-first, offline PWA acting as a person's external memory: universal capture (text/links/screenshots/PDFs/voice), on-device processing pipeline, hybrid natural-language search, memory threads, passive resurfacing, PWA infrastructure with share-target, Capacitor-ready codebase.

Work Log:
- Initialized fullstack env (Next.js 16 + TS + Tailwind 4 + shadcn/ui); installed dexie, dexie-react-hooks, chrono-node.
- Generated PWA icons (192/512/maskable) via sharp from an inline amber "ripple" SVG mark (scripts/gen-icons.mjs).
- Data layer (src/lib/types.ts, db.ts): Dexie schema — fragments, threads, jobs, settings; share-inbox DB (SW-compatible raw IDB schema); settings helpers; memory-boundary rule checks (isExcludedFromProcessing).
- ML layer: built-in lexical engine (hashed n-gram TF-IDF vectors, zero download — src/lib/ml/lexical.ts); remote ESM loader with bundler-ignore + script fallback (remote.ts); intelligence pack manager (packs.ts) — semantic (all-MiniLM-L6-v2 via transformers.js@3.7.5 CDN), vision (tesseract.js@5), voice (whisper-tiny.en), documents (pdf.js@4) — all downloaded once at first-run setup, cached for offline; audio decode→16kHz PCM (stt.ts).
- Processing pipeline (src/lib/pipeline/): dates.ts (chrono-node + confidence grading), urgency.ts (keyword signals + date proximity + confidence), category.ts, dedupe.ts (URL normalize + dHash perceptual hash + text cosine), threads.ts (time-proximity + topic-similarity clustering with bridge-merge, auto titles/summaries, relatedContext for "why did I save this?"), queue.ts (independent retryable jobs: CAPTURE→PERSIST→QUEUE→PROCESS→INDEX→SURFACE, prereq-aware, crash recovery, pack-ready re-queue sweeps, index rebuild).
- Capture (capture.ts): zero-friction, save-first, type auto-detection, image thumbs; delete/forget-topic/mark-opened/delete-all.
- Hybrid search (src/lib/search/): timeparse.ts (natural time windows + anchor mode "when I saved the Tokyo stuff"), search.ts (0.34 semantic + 0.24 keyword(BM25-lite, fuzzy stems) + phrase/URL + recency + thread + urgency + type weights; hard filters for lens/time; reason chips; boundary items excluded from index).
- Resurfacing (resurface.ts): deadline-soon (72h), weekly digest, decay (30d+ unopened, max 1, only when nothing urgent), opt-in on-this-day; notify.ts adapter (Capacitor-ready, sparse deadline notifications only).
- Export/storage (export.ts): full JSON export (optionally with base64 media), storage report via navigator.storage.estimate + per-type sums, drop-transcribed-audio saver; seed.ts (19 realistic fragments: laptop research thread, Tokyo trip, tax PDF with generated valid PDF + canvas screenshot images, dup link, meetings; runs REAL analyzers).
- UI (src/components/app/): warm stone+amber theme (globals.css), MemoryApp shell (liveQuery data, debounced search, notification scheduler, install prompt, share ingestion), SetupWizard (pack picker with sizes + honest Basic mode), AppHeader (persistent Local-only badge), SearchBar ("/" shortcut, time chips, anchor chip, basic-mode note), QuickCapture (paste images, drop, file pickers, ⌘↵), VoiceRecorder (MediaRecorder + level meter), InboxView (day-grouped feed + resurfacing cards with Yes/Not anymore/Forget topic/snooze + digest), TodayView (Overdue/Today/Tomorrow/Week/Later agenda), ThreadsView, TypeDrawer (lenses with counts, desktop sidebar + mobile sheet), FragmentDetail (content, extracted info with confidence, why-did-I-save context, dup merge, never-process switch, snooze/forget/delete), SettingsView (intelligence packs, privacy boundary rules, notifications, storage budget, data export/delete + Capacitor roadmap notes).
- PWA: manifest.json (share_target POST multipart, shortcuts, maskable icon), sw.js (network-first nav + offline fallback, cache-first statics + CDN model runtime cache, share-target POST handler → IDB inbox → redirect, notificationclick focus).
- Fixes during verification: template-literal typo in threads.ts; anchor regex used wrong capture group → rewritten with named group; setup skip-path wrongly claimed "ready" → attempted-state tracking; agenda missed past dates → nearestAnyDateMs for Overdue; seed created threads before fragments existed (threads deleted) → reordered; SW registration missed when page already loaded → readyState check; SW share-inbox open with explicit version → VersionError vs Dexie v10 → versionless open; tsconfig target ES2017→ES2020 for named capture groups.

Verification (agent-browser, end-to-end):
- Setup wizard (welcome → packs → skip → "Ready (Basic mode)" → start) renders, no console errors.
- Seed: 19 fragments; deadlines/meetings detected with confidence chips; dup badge; day-grouped feed.
- Search: "that laptop fixing article" → laptop results ranked with reason chips; "when I saved the Tokyo stuff" → 3 Tokyo items from 2 months ago (anchor window works).
- Live capture: "Team offsite planning meeting Friday 2pm — don't forget…" → saved instantly, dates extracted (Thu + Fri 2pm), urgency high, thread auto-created, resurfaced as "Possible meeting … medium confidence".
- Today agenda: Overdue (dentist), Rest of week (standup Fri 10am, "by next week" Tue), Later (tax Sep 26).
- Threads view: auto-generated "Laptop topic", "Shinjuku research", "Account planning" with summaries + confidence.
- Fragment detail: "Likely related to: Laptop topic — based on 7 fragments saved within 95 hours (low confidence)" + related items.
- Type drawer lenses (Screenshots 2, Deadlines 8, …), storage budget (276 KB / 10 GB + per-type bars), data wipe (delete-all → reload → empty), re-seed.
- Share-target: simulated Android share POST via SW → pending inbox → app reload → fragment ingested with toast.
- Offline: set offline → reload → full app shell + data + search all work from SW cache/IndexedDB.
- ESLint clean; tsc clean (app code); dev.log no runtime errors; VLM visual QA: polished, no overlaps/cut-offs.

Stage Summary:
- Deliverable: complete offline-first PWA "Recall" at src/app/page.tsx (single client-side route), PWA assets in public/ (manifest.json, sw.js, icons).
- Architecture is Capacitor-ready: browser-only APIs isolated in notify.ts / sw-register.ts / capture (blobs) with migration notes; standard web stack; no framework lock-in.
- Intelligence packs download-once from CDN at first-run; built-in lexical engine guarantees capture/search even with zero packs (honest "not ready" states shown per pack).
- All extracted data (dates, urgency, category, threads, duplicates) carries High/Medium/Low confidence and is never presented as fact.

---
Task ID: 2
Agent: main (Super Z)
Task: Apply V2 additions to "Recall": (1) UI/visual overhaul — mobile-first bottom nav, dominant capture bar, light+dark themes with system auto-detect and manual override, distinct personality (new accent/surfaces/fonts, no generic UI-kit look), calm human component tone, touch ergonomics with swipe gestures; (2) GitHub Pages hosting — static, subpath-safe build with Actions workflow.

Work Log:
- Read entire existing codebase (all app components, sw.js, manifest, configs, worklog from Task 1).
- Design system (globals.css): replaced amber/stone palette with persimmon-coral primary + warm ivory light theme / warm espresso dark theme; --radius 1rem; font-display (Fraunces) + font-sans (Nunito Sans) via @fontsource-variable packages (npm-bundled, offline-safe); color-scheme light/dark; coral-tinted selection.
- Theme system (src/lib/theme.ts): 'system'|'light'|'dark' pref in localStorage; no-FOUC inline script in layout.tsx runs pre-paint; useSyncExternalStore-based useTheme (no setState-in-effect — fixed after ESLint flagged it); matchMedia live-follow in system mode; quick cycle toggle in AppHeader + Settings → Appearance tab (radiogroup).
- Layout restructure: new BottomNav.tsx (5 tabs: Home/Today/Search/Threads/Settings, safe-area padding, processing indicator, active coral pill); new Sidebar.tsx (desktop lg+ only: brand, nav, lenses with counts, settings, local badge); deleted TypeDrawer.tsx (+ drawerOpen removed from store); new LensChips.tsx (scrollable chip row on Home, mobile only); store gained searchFocusToken/focusSearch for the Search tab.
- QuickCapture redesigned as hero: coral gradient card with blurred glow decorations, larger textarea, round attach buttons, prominent pill Save button, drag-over scale/ring.
- Calm tone: ConfidenceChip → soft sage/apricot/neutral pills with dots; UrgencyDot rose/amber/stone; EmptyState rounded-3xl + Fraunces titles + friendlier copy; ProcessingBadge partial → soft pill; duplicate badges/notices amber → coral tints; DigestCard + ResurfaceCard recolored + rounded-3xl.
- Swipe gestures: new SwipeRow.tsx (framer-motion drag="x", threshold 88px, soft color reveals) — resurfaced cards: swipe right = dismiss "Got it" (emerald), swipe left = snooze (amber); buttons kept for accessibility.
- View polish: TodayView/ThreadsView Fraunces headings; search idle view (SearchIdleView) with clickable example queries; SearchBar rounded-full + focus-token wiring; SetupWizard rounded-3xl cards + coral shadows; FragmentCard rounded-3xl with coral type icon.
- GitHub Pages: next.config.ts → output 'export', trailingSlash, basePath from NEXT_PUBLIC_BASE_PATH, images unoptimized, distDir overridable (learned: custom distDir becomes the EXPORT dir; default build → out/); deleted src/app/api (route handlers break export); package.json build scripts simplified; manifest.json → all-relative paths (start_url/scope/id "./", icons, share_target action "share-target", shortcut); sw.js v4 → scope-relative asset() helper for precache/static/nav-cache/share-redirect/notificationclick, endsWith('/share-target') detection; sw-register.ts → relative register('sw.js', {scope:'./'}); public/.nojekyll; .github/workflows/deploy.yml (checkout → node22 + bun → frozen install → next build with NEXT_PUBLIC_BASE_PATH=/repo → .nojekyll → upload-pages-artifact → deploy-pages); README.md with full manual deploy docs; .gitignore entries for custom dist dirs.
- Regenerated PWA icons + favicon + logo.svg with new coral gradient (#ff9266→#cc3d1e).
- Verification: ESLint clean; tsc clean for src (remaining errors only from scaffold/skills dirs + stale .next validator); agent-browser E2E on dev build at 390×844 and 1440×900: wizard → basic mode → seed → lens chips filter → live capture ("Pay the electricity bill by Friday 5pm" → deadline detected tomorrow 5PM medium, urgency high, auto-resurfaced) → search idle + example chips → 13-match search → threads → settings Appearance radios → theme toggle persistence (localStorage + dark class across reloads) → bottom nav hidden on desktop / sidebar visible (computed styles) → last-card clearance 83px above bottom nav → VLM visual QA (personality/capture dominance/nav all pass; flagged items verified as dev-only toolbar or intentional scroll affordance).
- Static export verification: built with NEXT_PUBLIC_BASE_PATH=/recall NEXT_DIST_DIR=.next-pages; served via python http.server at /recall/: page 200, SW controlled at subpath scope, manifest resolves relatively, all 14 assets under /recall/_next, zero console errors; full flow re-verified on export (wizard → seed → capture with date detection → threads); offline test: network cut (fetch to external URL fails) yet full reload works from SW cache with all data.
- Refreshed download/ screenshots (mobile light/dark, desktop) + updated download/README.md with V2 deliverables summary.

Stage Summary:
- V2 UI shipped: mobile-first bottom nav + desktop sidebar, dominant coral capture hero, light/dark/system themes, Fraunces + Nunito Sans personality, calm confidence/resurfacing UI, swipe-to-dismiss/snooze.
- GitHub Pages shipped: fully static export, subpath-safe assets/manifest/SW, GitHub Actions workflow + manual deploy docs; verified offline at a /repo/ subpath.
- All V1 functionality preserved (capture pipeline, hybrid search, threads, resurfacing, data controls); dev server healthy on port 3000.
