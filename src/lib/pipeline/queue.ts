/**
 * Independent job queue — V3: non-blocking, priority lanes, concurrent.
 *
 * CAPTURE → PERSIST → QUEUE → PROCESS → INDEX → SURFACE still holds, but
 * the runner is no longer one serialized main-thread loop:
 *
 *   1. OFF THE UI THREAD — all compute (dates/urgency/category, lexical
 *      and semantic embeddings, OCR, transcription, PDF text, dHash) runs
 *      in a pool of Web Workers. The main thread only orchestrates and
 *      writes results to IndexedDB.
 *   2. PRIORITY LANES — 'light' jobs (text parsing, date/urgency
 *      extraction on plain notes) are ALWAYS dispatched before 'heavy'
 *      jobs (OCR / transcription / PDF / semantic embeddings), no matter
 *      which was queued first. A queued screenshot OCR can never delay
 *      the enrichment of a plain text note captured after it.
 *   3. INDEPENDENT EXECUTION — jobs for different fragments run
 *      concurrently across the pool (at most one job per fragment at a
 *      time, so a fragment's steps stay ordered). One slow OCR never
 *      delays unrelated fragments.
 *
 * Save-first is untouched: the fragment row is persisted BEFORE any job
 * is queued, and raw content is searchable immediately. A failed or
 * skipped job never blocks the fragment.
 */
import { db, getSettings, isExcludedFromProcessing } from '../db'
import type { Fragment, Job, JobStep, PackId, StepStatus } from '../types'
import { extractDates } from './dates'
import { scoreUrgency } from './urgency'
import { inferCategory } from './category'
import { detectDuplicate } from './dedupe'
import { associateThread } from './threads'
import { lexicalVector } from '../ml/lexical'
import { decodeAudio16k } from '../ml/stt'
import { getPool } from '../workers/pool'
import { stepLane, type Lane } from '../workers/protocol'
import type { WorkerOpName } from '../workers/protocol'

const MAX_ATTEMPTS = 3
/** concurrent main-thread appliers (dedupe/thread do DB reads + ms-scale math) */
const MAIN_JOB_SLOTS = 2

/** jobs that must wait for the type's text-extraction step to resolve */
const EXTRACTION_DEPENDENT: JobStep[] = ['dates', 'urgency', 'category', 'embed', 'embed-semantic', 'dedupe', 'thread']
const EMBED_DEPENDENT: JobStep[] = ['dedupe', 'thread']

export function jobsForFragment(f: Fragment, semanticReady = false): JobStep[] {
  const tail: JobStep[] = ['dates', 'urgency', 'category', 'embed']
  if (semanticReady) tail.push('embed-semantic')
  tail.push('dedupe', 'thread')
  switch (f.type) {
    case 'link':
    case 'text':
      return tail
    case 'image':
      return ['ocr', ...tail]
    case 'pdf':
      return ['extract-pdf', ...tail]
    case 'audio':
      return ['transcribe', ...tail]
  }
}

function allStepsSkipped(steps: JobStep[]): Partial<Record<JobStep, StepStatus>> {
  return Object.fromEntries(steps.map((s) => [s, 'skipped' as StepStatus]))
}

function computeStatus(f: Fragment): Fragment['processing']['status'] {
  const steps = Object.values(f.processing.steps)
  if (steps.some((s) => s === 'pending' || s === 'running')) return 'processing'
  if (steps.some((s) => s === 'failed')) return 'partial'
  return 'ready'
}

function packForStep(step: JobStep): PackId | null {
  switch (step) {
    case 'ocr':
      return 'vision'
    case 'extract-pdf':
      return 'documents'
    case 'transcribe':
      return 'voice'
    case 'embed-semantic':
      return 'semantic'
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* in-memory queue state                                                */
/* ------------------------------------------------------------------ */

interface QEntry {
  job: Job
  lane: Lane
  /** retry backoff — not dispatchable before this timestamp */
  notBefore: number
}

export interface RunningInfo {
  job: Job
  lane: Lane
  startedAt: number
}

export interface RecentEvent {
  step: JobStep
  fragmentId: string
  ok: boolean
  error?: string
  ms?: number
  at: number
}

const pending: QEntry[] = []
const running = new Map<QEntry, RunningInfo>()
const runningByFragment = new Set<string>()
/** fragmentId -> {type, steps} — cheap prereq checks without re-reading blobs */
const fragIndex = new Map<string, { type: Fragment['type']; steps: Partial<Record<JobStep, StepStatus>> }>()
const recent: RecentEvent[] = []

function updateIndex(f: Fragment) {
  fragIndex.set(f.id, { type: f.type, steps: f.processing.steps })
}

export interface QueueStatsSnapshot {
  running: RunningInfo[]
  pendingLight: number
  pendingHeavy: number
  recent: RecentEvent[]
  pool: { size: number; heavyCap: number; alive: number; free: number } | null
}

export function getQueueStats(): QueueStatsSnapshot {
  const pool = getPool()
  return {
    running: Array.from(running.values()),
    pendingLight: pending.filter((e) => e.lane === 'light').length,
    pendingHeavy: pending.filter((e) => e.lane === 'heavy').length,
    recent: recent.slice(-12).reverse(),
    pool: pool ? pool.stats() : null,
  }
}

function pushRecent(e: QEntry, ok: boolean, error?: string, ms?: number) {
  recent.push({ step: e.job.type, fragmentId: e.job.fragmentId, ok, error, ms, at: Date.now() })
  if (recent.length > 40) recent.splice(0, recent.length - 40)
}

/* ------------------------------------------------------------------ */
/* scheduler                                                            */
/* ------------------------------------------------------------------ */

let kickTimer: ReturnType<typeof setTimeout> | null = null
let kickAt = 0

export function kick(delay = 0) {
  const at = Date.now() + delay
  if (kickTimer !== null && at >= kickAt) return
  if (kickTimer !== null) clearTimeout(kickTimer)
  kickAt = at
  kickTimer = setTimeout(() => {
    kickTimer = null
    void dispatchLoop()
  }, Math.max(0, at - Date.now()))
}

let dispatching = false

async function dispatchLoop(): Promise<void> {
  if (dispatching) {
    kick(50)
    return
  }
  dispatching = true
  try {
    for (;;) {
      const pool = getPool()
      const totalSlots = (pool?.size ?? 2) + MAIN_JOB_SLOTS
      if (running.size >= totalSlots) break

      const now = Date.now()
      const heavyRunning = Array.from(running.values()).filter((r) => r.lane === 'heavy').length
      const heavyCap = pool?.heavyCap ?? 1

      // light first — ALWAYS, regardless of queue position
      let entry = await nextRunnable('light', now)
      // then heavy, capped so model jobs don't flood memory
      if (!entry && heavyRunning < heavyCap) entry = await nextRunnable('heavy', now)
      if (!entry) break

      beginEntrySync(entry)
      void runEntry(entry)
    }
  } finally {
    dispatching = false
  }
}

async function nextRunnable(lane: Lane, now: number): Promise<QEntry | null> {
  const candidates = pending
    .filter((e) => e.lane === lane && e.notBefore <= now && !runningByFragment.has(e.job.fragmentId))
    .sort((a, b) => a.job.createdAt - b.job.createdAt || (a.job.id ?? 0) - (b.job.id ?? 0))
  for (const e of candidates) {
    if (!(await prereqResolved(e.job))) continue
    pending.splice(pending.indexOf(e), 1)
    return e
  }
  return null
}

async function prereqResolved(job: Job): Promise<boolean> {
  let info = fragIndex.get(job.fragmentId)
  if (!info) {
    const f = await db.fragments.get(job.fragmentId)
    if (!f) return true // orphan — the runner cleans it up
    info = { type: f.type, steps: f.processing.steps }
    fragIndex.set(job.fragmentId, info)
  }
  const extraction: JobStep | null =
    info.type === 'image' ? 'ocr' : info.type === 'pdf' ? 'extract-pdf' : info.type === 'audio' ? 'transcribe' : null
  if (extraction && EXTRACTION_DEPENDENT.includes(job.type)) {
    const st = info.steps[extraction]
    if (st === 'pending' || st === 'running') return false
    // failed extraction must NOT block downstream — run on raw content
  }
  if (EMBED_DEPENDENT.includes(job.type)) {
    const st = info.steps.embed
    if (st === 'pending' || st === 'running') return false
  }
  return true
}

/** marks the job as running SYNCHRONOUSLY so no second dispatch can race it */
function beginEntrySync(e: QEntry) {
  runningByFragment.add(e.job.fragmentId)
  running.set(e, { job: e.job, lane: e.lane, startedAt: Date.now() })
  e.job.status = 'running'
  e.job.startedAt = Date.now()
  e.job.updatedAt = Date.now()
  if (e.job.id != null) void db.jobs.put(e.job)
}

/* ------------------------------------------------------------------ */
/* executors — worker compute + main-thread appliers                    */
/* ------------------------------------------------------------------ */

interface StepResult {
  skipped?: boolean
  /** dedupe/thread persist everything themselves */
  external?: boolean
}

const SKIPPED: StepResult = { skipped: true }

async function appendText(f: Fragment, text: string) {
  const t = (text || '').replace(/\s+\n/g, '\n').trim()
  if (!t) return
  const base = (f.textContent || '').trim()
  f.textContent = base ? `${base}\n${t}` : t
}

/** light ops fall back to inline compute when Workers are unsupported (µs-scale) */
async function execLight<T>(op: WorkerOpName, payload: unknown, local: () => T): Promise<T> {
  const pool = getPool()
  if (!pool) return local()
  return pool.exec<T>(op, payload)
}

function requirePool() {
  const pool = getPool()
  if (!pool) throw new Error('workers-unavailable')
  return pool
}

function fragmentText(f: Fragment): string {
  return `${f.rawContent}\n${f.textContent}`
}

const EXECUTORS: Record<JobStep, (f: Fragment) => Promise<StepResult>> = {
  dates: async (f) => {
    const text = fragmentText(f)
    const dates = await execLight('enrich-dates', { text }, () => extractDates(text))
    f.extracted = { ...f.extracted, dates }
    return {}
  },
  urgency: async (f) => {
    const text = fragmentText(f)
    const urgency = await execLight('enrich-urgency', { text, dates: f.extracted.dates ?? [] }, () =>
      scoreUrgency(text, f.extracted.dates ?? [])
    )
    f.extracted = { ...f.extracted, urgency }
    return {}
  },
  category: async (f) => {
    const text = fragmentText(f)
    const c = await execLight('enrich-category', { text, dates: f.extracted.dates ?? [] }, () =>
      inferCategory(text, f.extracted.dates ?? [])
    )
    f.extracted = { ...f.extracted, category: c ?? undefined }
    return {}
  },
  embed: async (f) => {
    const text = fragmentText(f).trim()
    const { vector } = await execLight('embed-text', { text }, () => ({ vector: lexicalVector(text) }))
    f.lexicalEmbedding = { model: 'lexical', dim: vector.length, vector }
    return {}
  },
  'embed-semantic': async (f) => {
    const settings = await getSettings()
    const text = fragmentText(f).trim()
    if (settings.packs.semantic !== 'ready' || !text) return SKIPPED
    const pool = requirePool()
    const { vector } = await pool.exec<{ vector: Float32Array }>('embed-semantic', { text }, { affinity: 'pinned' })
    f.semanticEmbedding = { model: 'semantic', dim: vector.length, vector }
    return {}
  },
  ocr: async (f) => {
    const settings = await getSettings()
    if (settings.packs.vision !== 'ready' || !f.blob) return SKIPPED
    const pool = requirePool()
    const buffer = await f.blob.arrayBuffer()
    const { text } = await pool.exec<{ text: string }>('ocr', { buffer }, { affinity: 'pinned', transfer: [buffer] })
    await appendText(f, text)
    return {}
  },
  'extract-pdf': async (f) => {
    const settings = await getSettings()
    if (settings.packs.documents !== 'ready' || !f.blob) return SKIPPED
    const pool = requirePool()
    const buffer = await f.blob.arrayBuffer()
    const { text } = await pool.exec<{ text: string }>(
      'pdf-extract',
      { buffer },
      { affinity: 'pinned', transfer: [buffer] }
    )
    await appendText(f, text.slice(0, 200_000))
    return {}
  },
  transcribe: async (f) => {
    const settings = await getSettings()
    if (settings.packs.voice !== 'ready' || !f.blob) return SKIPPED
    // decodeAudioData is a native async op — the browser decodes off-thread.
    // The heavy whisper inference happens in the worker.
    const pcm = await decodeAudio16k(f.blob)
    const pool = requirePool()
    const { text } = await pool.exec<{ text: string }>('transcribe', { pcm }, { affinity: 'pinned', transfer: [pcm] })
    await appendText(f, text)
    return {}
  },
  dedupe: async (f) => {
    await detectDuplicate(f)
    return { external: true }
  },
  thread: async (f) => {
    await associateThread(f.id)
    return { external: true }
  },
}

/* ------------------------------------------------------------------ */
/* runner                                                               */
/* ------------------------------------------------------------------ */

async function runEntry(e: QEntry): Promise<void> {
  const startedAt = Date.now()
  const { job } = e
  try {
    const f = await db.fragments.get(job.fragmentId)
    if (!f) {
      if (job.id != null) await db.jobs.delete(job.id)
      return
    }
    const result = await EXECUTORS[job.type](f)
    // re-read to merge anything an executor persisted itself (dedupe/thread)
    const fresh = (await db.fragments.get(job.fragmentId)) ?? f
    if (!result.external) {
      fresh.textContent = f.textContent
      fresh.extracted = f.extracted
      fresh.lexicalEmbedding = f.lexicalEmbedding
      fresh.semanticEmbedding = f.semanticEmbedding
      fresh.perceptualHash = f.perceptualHash ?? fresh.perceptualHash
    }
    fresh.processing.steps[job.type] = result.skipped ? 'skipped' : 'done'
    fresh.processing.status = computeStatus(fresh)
    await db.fragments.put(fresh)
    updateIndex(fresh)
    if (job.id != null) await db.jobs.delete(job.id)
    pushRecent(e, true, undefined, Date.now() - startedAt)
  } catch (e2) {
    const msg = (e2 as Error)?.message ?? String(e2)
    const attempts = job.attempts + 1
    if (attempts >= job.maxAttempts) {
      // fragment remains saved & searchable by raw content
      const f = await db.fragments.get(job.fragmentId)
      if (f) {
        f.processing.steps[job.type] = 'failed'
        f.processing.lastError = msg
        f.processing.status = computeStatus(f)
        await db.fragments.put(f)
        updateIndex(f)
      }
      if (job.id != null) await db.jobs.delete(job.id)
      pushRecent(e, false, msg, Date.now() - startedAt)
    } else {
      job.attempts = attempts
      job.status = 'pending'
      job.error = msg
      job.updatedAt = Date.now()
      if (job.id != null) await db.jobs.put(job)
      pending.push({ job, lane: e.lane, notBefore: Date.now() + 1200 * attempts })
      kick(1200 * attempts)
    }
  } finally {
    runningByFragment.delete(job.fragmentId)
    running.delete(e)
    kick()
  }
}

/* ------------------------------------------------------------------ */
/* public API                                                           */
/* ------------------------------------------------------------------ */

async function addJobs(entries: Array<{ fragmentId: string; step: JobStep }>, now = Date.now()): Promise<void> {
  if (!entries.length) return
  const rows: Job[] = entries.map(({ fragmentId, step: s }) => ({
    fragmentId,
    type: s,
    status: 'pending' as const,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    createdAt: now,
    updatedAt: now,
    priority: stepLane(s) === 'light' ? 0 : 1,
    lane: stepLane(s),
  }))
  const keys = await Promise.all(rows.map((r) => db.jobs.add(r)))
  rows.forEach((r, i) => {
    r.id = keys[i]
    pending.push({ job: r, lane: r.lane as Lane, notBefore: 0 })
  })
  kick()
}

/** persist job rows + flip fragment into processing state */
export async function enqueueFragmentJobs(f: Fragment): Promise<void> {
  const settings = await getSettings()
  const steps = jobsForFragment(f, settings.packs.semantic === 'ready')
  if (isExcludedFromProcessing(f, settings.boundaryRules)) {
    // Memory boundary — excluded from OCR/embeddings/indexing entirely.
    f.processing = { status: 'ready', steps: allStepsSkipped(steps) }
    await db.fragments.put(f)
    updateIndex(f)
    return
  }
  f.processing = { status: 'processing', steps: Object.fromEntries(steps.map((s) => [s, 'pending' as StepStatus])) }
  await db.fragments.put(f)
  updateIndex(f)
  await addJobs(steps.map((s) => ({ fragmentId: f.id, step: s })))
}

/** reset jobs stuck in 'running' after a crash/reload */
export async function recoverStuckJobs(): Promise<void> {
  await db.jobs.filter((j) => j.status === 'running').modify({ status: 'pending' as const, updatedAt: Date.now() })
}

/** when a pack finishes downloading, re-queue everything it unblocks */
export async function requeueForPack(pack: PackId): Promise<void> {
  const settings = await getSettings()
  const step: JobStep | null =
    pack === 'vision'
      ? 'ocr'
      : pack === 'documents'
        ? 'extract-pdf'
        : pack === 'voice'
          ? 'transcribe'
          : pack === 'semantic'
            ? 'embed-semantic'
            : null
  if (!step) return
  const now = Date.now()
  const skippedIsStep = (f: Fragment) => f.processing.steps[step] === 'skipped'
  const needsSemantic = (f: Fragment) => !f.semanticEmbedding && (f.textContent || f.rawContent)

  const frags = (await db.fragments.toArray()).filter(
    (f) =>
      !isExcludedFromProcessing(f, settings.boundaryRules) &&
      (pack === 'semantic' ? needsSemantic(f) : skippedIsStep(f))
  )

  for (const f of frags) {
    f.processing.steps[step] = 'pending'
    f.processing.status = computeStatus(f)
    await db.fragments.put(f)
    updateIndex(f)
  }
  await addJobs(frags.map((f) => ({ fragmentId: f.id, step })), now)
}

/** rebuild lexical (+semantic when available) index for every fragment */
export async function rebuildIndex(): Promise<void> {
  const settings = await getSettings()
  const now = Date.now()
  const semanticReady = settings.packs.semantic === 'ready'
  const entries: Array<{ fragmentId: string; step: JobStep }> = []
  await db.transaction('rw', db.fragments, async () => {
    const frags = (await db.fragments.toArray()).filter((f) => !isExcludedFromProcessing(f, settings.boundaryRules))
    for (const f of frags) {
      f.lexicalEmbedding = undefined
      f.semanticEmbedding = undefined
      f.processing.steps.embed = 'pending'
      f.processing.steps['embed-semantic'] = semanticReady ? 'pending' : 'skipped'
      f.processing.status = computeStatus(f)
      await db.fragments.put(f)
      updateIndex(f)
      if (f.textContent || f.rawContent) {
        entries.push({ fragmentId: f.id, step: 'embed' })
        if (semanticReady) entries.push({ fragmentId: f.id, step: 'embed-semantic' })
      }
    }
  })
  await addJobs(entries, now)
}

/** boot: recover crash-stuck jobs, rebuild the in-memory queue, pre-warm workers */
export function startQueue() {
  void (async () => {
    await recoverStuckJobs()
    try {
      await db.fragments.each((f) => updateIndex(f))
    } catch (e) {
      console.warn('[recall] fragment index build failed', (e as Error)?.message)
    }
    const rows = await db.jobs.where('status').equals('pending').toArray()
    for (const job of rows) {
      pending.push({ job, lane: job.lane ?? stepLane(job.type), notBefore: 0 })
    }
    // pre-warm the worker pool so the first capture doesn't pay spawn cost
    getPool()
      ?.ensure()
      .catch(() => {})
    kick(400)
  })()
}
