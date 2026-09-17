/**
 * Universal capture — zero friction: no titles, no folders, no tags.
 * The fragment is PERSISTED IMMEDIATELY, then processed asynchronously.
 */
import { db } from './db'
import type { Fragment, FragmentType } from './types'
import { enqueueFragmentJobs } from './pipeline/queue'

const URL_RE = /^https?:\/\/\S+$/i

export function detectType(text: string, mimeType?: string): FragmentType {
  if (mimeType?.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType?.startsWith('audio/')) return 'audio'
  const t = text.trim()
  if (URL_RE.test(t)) return 'link'
  return 'text'
}

/** small local thumbnail so the feed stays fast — image never leaves device */
async function makeThumb(blob: Blob): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob)
    const max = 320
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    return c.toDataURL('image/jpeg', 0.72)
  } catch {
    return undefined
  }
}

export interface CaptureInput {
  text?: string
  blob?: Blob
  fileName?: string
  mimeType?: string
  origin?: string
  originNote?: string
}

export async function createFragment(input: CaptureInput): Promise<Fragment> {
  const text = (input.text ?? '').trim()
  const type = input.blob
    ? detectType('', input.mimeType ?? input.blob.type)
    : detectType(text)

  const fragment: Fragment = {
    id: crypto.randomUUID(),
    type,
    createdAt: Date.now(),
    rawContent: input.blob ? input.fileName ?? input.blob.type ?? 'file' : text,
    textContent: input.blob ? input.fileName ?? '' : text,
    blob: input.blob,
    mimeType: input.mimeType ?? input.blob?.type,
    origin: input.origin ?? 'manual',
    originNote: input.originNote,
    processing: { status: 'raw', steps: {} },
    extracted: { dates: [], urgency: { level: 'none', score: 0, signals: [], confidence: 'low' } },
  }

  if (type === 'image' && input.blob) {
    fragment.thumb = await makeThumb(input.blob)
  }

  // PERSIST FIRST — never block on processing
  await db.fragments.put(fragment)

  // then queue background processing
  await enqueueFragmentJobs(fragment)

  return fragment
}

export async function deleteFragment(id: string): Promise<void> {
  const f = await db.fragments.get(id)
  if (!f) return
  await db.fragments.delete(id)
  await db.jobs.where('fragmentId').equals(id).delete()
  const { pruneThread } = await import('./pipeline/threads')
  await pruneThread(f.threadId)
}

/** "Forget this topic" — keep data, stop resurfacing fragment + its thread */
export async function forgetTopic(id: string): Promise<void> {
  const f = await db.fragments.get(id)
  if (!f) return
  f.suppressed = true
  f.dismissedAt = Date.now()
  await db.fragments.put(f)
  if (f.threadId) {
    const thread = await db.threads.get(f.threadId)
    if (thread) {
      thread.suppressed = true
      await db.threads.put(thread)
    }
  }
}

export async function markOpened(id: string): Promise<void> {
  const f = await db.fragments.get(id)
  if (!f) return
  f.openCount = (f.openCount ?? 0) + 1
  f.lastOpenedAt = Date.now()
  await db.fragments.put(f)
}

export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', db.fragments, db.threads, db.jobs, db.settings, async () => {
    await db.fragments.clear()
    await db.threads.clear()
    await db.jobs.clear()
  })
}
