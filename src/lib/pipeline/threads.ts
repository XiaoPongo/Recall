/**
 * Memory threads — automatic grouping by time proximity + topic similarity.
 * No manual folders, ever. Members link into connected clusters.
 */
import { db } from '../db'
import type { Confidence, Fragment, Thread } from '../types'
import { cosine, salientTerms } from '../ml/lexical'

const TIME_WINDOW_MS = 45 * 60 * 1000 // fragments saved within 45 minutes
const STRONG_SIM = 0.42
const LINK_SIM = 0.30
const TIME_LINK_SIM = 0.14

function sim(a: Fragment, b: Fragment): number {
  const sem = cosine(a.semanticEmbedding?.vector, b.semanticEmbedding?.vector)
  if (sem > 0) return sem
  return cosine(a.lexicalEmbedding?.vector, b.lexicalEmbedding?.vector)
}

export async function associateThread(fragmentId: string): Promise<void> {
  const f = await db.fragments.get(fragmentId)
  if (!f) return
  const others = (await db.fragments.toArray()).filter(
    (o) => o.id !== f.id && (o.textContent || o.rawContent)
  )
  if (!others.length) {
    await createThreadFor(f)
    return
  }

  const scored = others
    .map((o) => {
      const s = sim(f, o)
      const dt = Math.abs(o.createdAt - f.createdAt)
      const timeBoost = dt < TIME_WINDOW_MS ? 0.28 * (1 - dt / TIME_WINDOW_MS) : 0
      return { o, s, dt, total: s + timeBoost }
    })
    .sort((a, b) => b.total - a.total)

  const related = scored.filter((x) => x.s >= STRONG_SIM || (x.dt < TIME_WINDOW_MS && x.s >= TIME_LINK_SIM)).slice(0, 8)

  if (!related.length) {
    await createThreadFor(f)
    return
  }

  // dominant thread among related fragments
  const threadScores = new Map<string, number>()
  for (const r of related) {
    if (!r.o.threadId) continue
    threadScores.set(r.o.threadId, (threadScores.get(r.o.threadId) ?? 0) + r.total)
  }

  let dominant: string | null = null
  let bestScore = 0
  threadScores.forEach((v, k) => {
    if (v > bestScore) {
      bestScore = v
      dominant = k
    }
  })

  if (!dominant) {
    await createThreadFor(f)
    return
  }

  // bridge merge: a second strong thread means these topics are actually one
  const second = Array.from(threadScores.entries())
    .filter(([k]) => k !== dominant)
    .sort((a, b) => b[1] - a[1])[0]
  if (second && second[1] > bestScore * 0.6) {
    await mergeThreads(second[0], dominant)
  }

  f.threadId = dominant
  await db.fragments.put(f)
  await recomputeThreadMeta(dominant)
}

async function createThreadFor(f: Fragment): Promise<string> {
  const id = crypto.randomUUID()
  const thread: Thread = {
    id,
    createdAt: f.createdAt,
    updatedAt: Date.now(),
    terms: salientTerms([`${f.textContent} ${f.rawContent}`], 3),
    title: '',
    summary: '',
    confidence: 'low',
    cohesion: 0,
  }
  f.threadId = id
  await db.fragments.put(f)
  await db.threads.put(thread)
  await recomputeThreadMeta(id)
  return id
}

async function mergeThreads(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return
  await db.transaction('rw', db.fragments, async () => {
    const members = await db.fragments.where('threadId').equals(fromId).toArray()
    for (const m of members) {
      m.threadId = intoId
      await db.fragments.put(m)
    }
  })
  await db.threads.delete(fromId)
  await recomputeThreadMeta(intoId)
}

function threadHint(members: Fragment[]): string {
  const n = members.length || 1
  const links = members.filter((m) => m.type === 'link' || m.type === 'pdf').length
  const images = members.filter((m) => m.type === 'image').length
  const audio = members.filter((m) => m.type === 'audio').length
  const dated = members.filter((m) => (m.extracted?.dates?.length ?? 0) > 0).length
  if (links / n >= 0.5) return 'research'
  if (images / n >= 0.5) return 'references'
  if (audio / n >= 0.5) return 'notes'
  if (dated / n >= 0.5) return 'planning'
  return 'topic'
}

export async function recomputeThreadMeta(threadId: string): Promise<void> {
  const thread = await db.threads.get(threadId)
  if (!thread) return
  const members = await db.fragments.where('threadId').equals(threadId).toArray()
  if (!members.length) {
    await db.threads.delete(threadId)
    return
  }

  const sample = members.slice(0, 12)
  let pairs = 0
  let sum = 0
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      sum += sim(sample[i], sample[j])
      pairs++
    }
  }
  const cohesion = pairs > 0 ? sum / pairs : 0

  const terms = salientTerms(
    members.slice(0, 20).map((m) => `${m.textContent} ${m.rawContent}`),
    4
  )
  const hint = threadHint(members)
  const topTerm = terms[0] ?? 'saved'
  const title = `${capitalize(topTerm)} ${hint}`

  const spanDays = Math.max(
    1,
    Math.ceil((Math.max(...members.map((m) => m.createdAt)) - Math.min(...members.map((m) => m.createdAt))) / 86_400_000)
  )
  const confidence: Confidence =
    members.length >= 3 && cohesion >= 0.4 ? 'high' : members.length >= 2 && cohesion >= 0.24 ? 'medium' : 'low'

  const daysLabel = spanDays === 1 ? 'the same day' : `about ${spanDays} days`
  thread.terms = terms
  thread.title = title
  thread.summary =
    `Looks like ${hint === 'research' ? 'research on' : 'a topic about'} “${topTerm}” — ${members.length} ` +
    `fragment${members.length === 1 ? '' : 's'} saved over ${daysLabel} (${confidence} confidence)`
  thread.cohesion = cohesion
  thread.confidence = confidence
  thread.updatedAt = Date.now()
  await db.threads.put(thread)
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

/** after deleting a fragment, prune its thread if it became empty */
export async function pruneThread(threadId?: string): Promise<void> {
  if (!threadId) return
  const count = await db.fragments.where('threadId').equals(threadId).count()
  if (count === 0) {
    await db.threads.delete(threadId)
  } else {
    await recomputeThreadMeta(threadId)
  }
}

/**
 * "Why did I save this?" — reconstructed context for a fragment.
 */
export interface RelatedFragment {
  fragment: Fragment
  reason: string
  score: number
}

export async function relatedContext(f: Fragment): Promise<{
  neighbors: RelatedFragment[]
  thread?: Thread
  threadMembers?: Fragment[]
  note?: string
}> {
  const others = (await db.fragments.toArray()).filter((o) => o.id !== f.id)
  const out: RelatedFragment[] = []
  const windowMs = 25 * 60 * 1000

  for (const o of others) {
    const dt = Math.abs(o.createdAt - f.createdAt)
    const s = sim(f, o)
    if (dt < windowMs && s >= 0.08) {
      out.push({ fragment: o, score: s, reason: `saved ${dt < 60_000 ? 'moments' : `${Math.round(dt / 60_000)} min`} apart` })
    } else if (o.threadId && o.threadId === f.threadId) {
      out.push({ fragment: o, score: s, reason: 'same memory thread' })
    } else if (s >= 0.4) {
      out.push({ fragment: o, score: s, reason: 'similar content' })
    }
  }

  out.sort((a, b) => b.score - a.score)
  const neighbors = out.slice(0, 6)

  let thread: Thread | undefined
  let threadMembers: Fragment[] | undefined
  let note: string | undefined
  if (f.threadId) {
    thread = await db.threads.get(f.threadId)
    threadMembers = await db.fragments.where('threadId').equals(f.threadId).toArray()
    const mins = Math.round(
      (Math.max(...threadMembers.map((m) => m.createdAt)) - Math.min(...threadMembers.map((m) => m.createdAt))) / 60_000
    )
    if (threadMembers.length >= 2) {
      const span = mins < 90 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`
      note = `Likely related to: ${thread?.title ?? 'a topic'} — based on ${threadMembers.length} fragments saved within ${span} (${thread?.confidence ?? 'low'} confidence)`
    }
  }

  return { neighbors, thread, threadMembers, note }
}
