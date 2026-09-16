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
