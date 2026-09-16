/**
 * Independent job queue: CAPTURE → PERSIST → QUEUE → PROCESS → INDEX → SURFACE.
 *
 * Every step (OCR, transcription, date extraction, urgency, embedding,
 * duplicate detection, thread association) is its own retryable job.
 * A failed job NEVER blocks the fragment — it stays saved and searchable
 * by raw content. Steps whose intelligence pack isn't downloaded are
 * marked "skipped" and re-queued once the pack arrives.
 */
import { db, getSettings, isExcludedFromProcessing } from '../db'
import type { Fragment, Job, JobStep, PackId, StepStatus } from '../types'
import { extractDates } from './dates'
import { scoreUrgency } from './urgency'
import { inferCategory } from './category'
import { detectDuplicate } from './dedupe'
import { associateThread } from './threads'
import { lexicalVector } from '../ml/lexical'
import { embedSemantic, extractPdfText, ocrImage, transcribeAudio } from '../ml/packs'
import { decodeAudio16k } from '../ml/stt'

const MAX_ATTEMPTS = 3

const PRIORITY: Record<JobStep, number> = {
  'extract-pdf': 10,
  ocr: 20,
  transcribe: 30,
  dates: 40,
  urgency: 45,
  category: 50,
  embed: 55,
  dedupe: 65,
  thread: 75,
}

/** jobs that must wait for the type's text-extraction step to resolve */
const EXTRACTION_DEPENDENT: JobStep[] = ['dates', 'urgency', 'category', 'embed', 'dedupe', 'thread']
const EMBED_DEPENDENT: JobStep[] = ['dedupe', 'thread']

export function jobsForFragment(f: Fragment): JobStep[] {
  switch (f.type) {
    case 'link':
    case 'text':
      return ['dates', 'urgency', 'category', 'embed', 'dedupe', 'thread']
    case 'image':
      return ['ocr', 'dates', 'urgency', 'category', 'embed', 'dedupe', 'thread']
    case 'pdf':
      return ['extract-pdf', 'dates', 'urgency', 'category', 'embed', 'dedupe', 'thread']
    case 'audio':
      return ['transcribe', 'dates', 'urgency', 'category', 'embed', 'dedupe', 'thread']
  }
}

function allStepsSkipped(steps: JobStep[]): Partial<Record<JobStep, StepStatus>> {
  return Object.fromEntries(steps.map((s) => [s, 'skipped' as StepStatus]))
}

/** persist job rows + flip fragment into processing state */
export async function enqueueFragmentJobs(f: Fragment): Promise<void> {
  const settings = await getSettings()
  const steps = jobsForFragment(f)
  if (isExcludedFromProcessing(f, settings.boundaryRules)) {
    // Memory boundary — excluded from OCR/embeddings/indexing entirely.
    f.processing = { status: 'ready', steps: allStepsSkipped(steps) }
    await db.fragments.put(f)
    return
  }
  f.processing = { status: 'processing', steps: Object.fromEntries(steps.map((s) => [s, 'pending' as StepStatus])) }
  await db.fragments.put(f)
  const now = Date.now()
  await db.jobs.bulkAdd(
    steps.map((s) => ({
      fragmentId: f.id,
      type: s,
      status: 'pending' as const,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
      priority: PRIORITY[s],
    }))
  )
  kick()
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
    default:
      return null
  }
}

function prereqResolved(f: Fragment, step: JobStep): 'ready' | 'wait' {
  const extraction: JobStep | null =
    f.type === 'image' ? 'ocr' : f.type === 'pdf' ? 'extract-pdf' : f.type === 'audio' ? 'transcribe' : null
  if (extraction && EXTRACTION_DEPENDENT.includes(step)) {
    const st = f.processing.steps[extraction]
    if (st === 'pending' || st === 'running') return 'wait'
    // failed extraction must NOT block downstream — run on raw content
  }
  if (EMBED_DEPENDENT.includes(step)) {
    const st = f.processing.steps.embed
    if (st === 'pending' || st === 'running') return 'wait'
  }
  return 'ready'
}

/* ------------------------------------------------------------------ */
/* job executors                                                        */
/* ------------------------------------------------------------------ */

const SKIPPED = Symbol('skipped')

type ExecResult = typeof SKIPPED | void

async function appendText(f: Fragment, text: string) {
  const t = (text || '').replace(/\s+\n/g, '\n').trim()
  if (!t) return
  const base = (f.textContent || '').trim()
  f.textContent = base ? `${base}\n${t}` : t
}

const EXECUTORS: Record<JobStep, (f: Fragment) => Promise<ExecResult>> = {
  'extract-pdf': async (f) => {
    const settings = await getSettings()
    if (settings.packs.documents !== 'ready' || !f.blob) return SKIPPED
    const buf = await f.blob.arrayBuffer()
    const text = await extractPdfText(buf.slice(0))
    await appendText(f, text.slice(0, 200_000))
  },
  ocr: async (f) => {
    const settings = await getSettings()
    if (settings.packs.vision !== 'ready' || !f.blob) return SKIPPED
    const text = await ocrImage(f.blob)
    await appendText(f, text)
  },
  transcribe: async (f) => {
    const settings = await getSettings()
    if (settings.packs.voice !== 'ready' || !f.blob) return SKIPPED
    const pcm = await decodeAudio16k(f.blob)
    const text = await transcribeAudio(pcm)
    await appendText(f, text)
  },
  dates: async (f) => {
    f.extracted = { ...f.extracted, dates: extractDates(`${f.rawContent}\n${f.textContent}`) }
  },
  urgency: async (f) => {
    f.extracted = { ...f.extracted, urgency: scoreUrgency(`${f.rawContent}\n${f.textContent}`, f.extracted.dates ?? []) }
  },
  category: async (f) => {
    f.extracted = { ...f.extracted, category: inferCategory(`${f.rawContent}\n${f.textContent}`, f.extracted.dates ?? []) }
  },
  embed: async (f) => {
    const text = `${f.rawContent}\n${f.textContent}`.trim()
    f.lexicalEmbedding = { model: 'lexical', dim: 640, vector: lexicalVector(text) }
    const settings = await getSettings()
    if (settings.packs.semantic === 'ready' && !isExcludedFromProcessing(f, settings.boundaryRules) && text) {
      try {
        const [v] = await embedSemantic([text])
        f.semanticEmbedding = { model: 'semantic', dim: v.length, vector: v }
      } catch (e) {
        // semantic failure is non-fatal — lexical index still works
        console.warn('[recall] semantic embed failed, keeping lexical only:', (e as Error)?.message)
      }
    }
  },
  dedupe: async (f) => {
    await detectDuplicate(f)
  },
  thread: async (f) => {
    await associateThread(f.id)
  },
}

/* ------------------------------------------------------------------ */
/* runner                                                               */
/* ------------------------------------------------------------------ */

let running = false
let pendingKick: ReturnType<typeof setTimeout> | null = null

export function kick(delay = 60) {
  if (pendingKick) return
  pendingKick = setTimeout(async () => {
    pendingKick = null
    await runLoop()
  }, delay)
}

async function runLoop() {
  if (running) return
  running = true
  try {
    for (;;) {
      const claimed = await claimNextRunnable()
      if (!claimed) break
      await runJob(claimed)
    }
  } finally {
    running = false
  }
}

async function claimNextRunnable(): Promise<Job | null> {
  return await db.transaction('rw', db.jobs, db.fragments, async () => {
    const candidates = (await db.jobs.where('status').equals('pending').toArray())
      .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)
    for (const job of candidates) {
      const f = await db.fragments.get(job.fragmentId)
      if (!f) {
        await db.jobs.delete(job.id!)
        continue
      }
      if (prereqResolved(f, job.type) !== 'ready') continue
      job.status = 'running'
      job.updatedAt = Date.now()
      await db.jobs.put(job)
      return job
    }
    return null
  })
}

async function runJob(job: Job) {
  const f = await db.fragments.get(job.fragmentId)
  if (!f) {
    await db.jobs.delete(job.id!)
    return
  }
  try {
    const result = await EXECUTORS[job.type](f)
    // Re-read to merge anything the executor persisted itself (dedupe/thread)
    const fresh = (await db.fragments.get(job.fragmentId)) ?? f
    if (job.type !== 'dedupe' && job.type !== 'thread') {
      fresh.textContent = f.textContent
      fresh.extracted = f.extracted
      fresh.lexicalEmbedding = f.lexicalEmbedding
      fresh.semanticEmbedding = f.semanticEmbedding
      fresh.perceptualHash = f.perceptualHash ?? fresh.perceptualHash
    }
    fresh.processing.steps[job.type] = result === SKIPPED ? 'skipped' : 'done'
    fresh.processing.status = computeStatus(fresh)
    await db.fragments.put(fresh)
    await db.jobs.delete(job.id!)
    kick()
  } catch (e) {
    const attempts = job.attempts + 1
    const msg = (e as Error)?.message ?? String(e)
    if (attempts >= job.maxAttempts) {
      // fragment remains saved & searchable by raw content
      const fresh = (await db.fragments.get(job.fragmentId)) ?? f
      fresh.processing.steps[job.type] = 'failed'
      fresh.processing.lastError = msg
      fresh.processing.status = computeStatus(fresh)
      await db.fragments.put(fresh)
      await db.jobs.delete(job.id!)
      kick()
    } else {
      await db.jobs.update(job.id!, { attempts, status: 'pending', updatedAt: Date.now(), error: msg })
      kick(1200 * attempts)
    }
  }
}

/** reset jobs stuck in 'running' after a crash/reload — called on app start */
export async function recoverStuckJobs(): Promise<void> {
  await db.jobs.filter((j) => j.status === 'running').modify({ status: 'pending' as const, updatedAt: Date.now() })
}

/** when a pack finishes downloading, re-queue everything it unblocks */
export async function requeueForPack(pack: PackId): Promise<void> {
  const settings = await getSettings()
  const step: JobStep | null =
    pack === 'vision' ? 'ocr' : pack === 'documents' ? 'extract-pdf' : pack === 'voice' ? 'transcribe' : null
  const now = Date.now()
  if (step) {
    const frags = (await db.fragments.toArray()).filter(
      (f) => f.processing.steps[step] === 'skipped' && !isExcludedFromProcessing(f, settings.boundaryRules)
    )
    for (const f of frags) {
      f.processing.steps[step] = 'pending'
      f.processing.status = computeStatus(f)
      await db.fragments.put(f)
      await db.jobs.add({
        fragmentId: f.id,
        type: step,
        status: 'pending',
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        createdAt: now,
        updatedAt: now,
        priority: PRIORITY[step],
      })
    }
  }
  if (pack === 'semantic') {
    const frags = (await db.fragments.toArray()).filter(
      (f) => !f.semanticEmbedding && !isExcludedFromProcessing(f, settings.boundaryRules) && (f.textContent || f.rawContent)
    )
    await db.jobs.bulkAdd(
      frags.map((f) => ({
        fragmentId: f.id,
        type: 'embed' as JobStep,
        status: 'pending' as const,
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        createdAt: now,
        updatedAt: now,
        priority: PRIORITY.embed,
      }))
    )
  }
  kick(200)
}

/** rebuild lexical (+semantic when available) index for every fragment */
export async function rebuildIndex(): Promise<void> {
  const settings = await getSettings()
  const now = Date.now()
  await db.transaction('rw', db.fragments, async () => {
    const frags = (await db.fragments.toArray()).filter((f) => !isExcludedFromProcessing(f, settings.boundaryRules))
    for (const f of frags) {
      f.lexicalEmbedding = undefined
      f.semanticEmbedding = undefined
      f.processing.steps.embed = 'pending'
      f.processing.status = computeStatus(f)
      await db.fragments.put(f)
    }
  })
  const frags = await db.fragments.toArray()
  await db.jobs.bulkAdd(
    frags
      .filter((f) => f.processing.steps.embed === 'pending')
      .map((f) => ({
        fragmentId: f.id,
        type: 'embed' as JobStep,
        status: 'pending' as const,
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        createdAt: now,
        updatedAt: now,
        priority: PRIORITY.embed,
      }))
  )
  kick(200)
}

export function startQueue() {
  void recoverStuckJobs().then(() => kick(400))
}
