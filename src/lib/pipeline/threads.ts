/**
 * Memory threads — automatic grouping by time proximity + topic similarity.
 * No manual folders, ever. Members link into connected clusters.
 *
 * Clustering DECISIONS (similarity, bridge merges, titles, cohesion) are
 * computed inside the processing worker; this module owns the IndexedDB
 * reads/writes and applies the worker's plan.
 */
import { db } from '../db'
import type { Confidence, Fragment, Thread } from '../types'
import { getPool } from '../workers/pool'
import { associatePlan, relatedScores, threadMeta, toThreadOther, toThreadSelf } from './threads-core'
import type { RelatedScore, ThreadMetaResult, ThreadPlan } from '../workers/protocol'

async function planInWorker(self: Fragment, others: Fragment[]): Promise<ThreadPlan> {
  const payload = {
    self: toThreadSelf(self),
    others: others.map(toThreadOther),
  }
  const pool = getPool()
  if (pool) {
    try {
      return await pool.exec<ThreadPlan>('thread-plan', payload)
    } catch (e) {
      console.warn('[recall] thread plan in worker failed, computing inline:', (e as Error)?.message)
    }
  }
  return associatePlan(payload.self, payload.others)
}

async function metaInWorker(members: Fragment[]): Promise<ThreadMetaResult> {
  const payload = {
    members: members.map((m) => ({
      text: `${m.textContent} ${m.rawContent}`,
      type: m.type,
      createdAt: m.createdAt,
      hasDates: (m.extracted?.dates?.length ?? 0) > 0,
      lex: m.lexicalEmbedding?.vector ?? null,
      sem: m.semanticEmbedding?.vector ?? null,
    })),
  }
  const pool = getPool()
  if (pool) {
    try {
      return await pool.exec<ThreadMetaResult>('thread-meta', payload)
    } catch (e) {
      console.warn('[recall] thread meta in worker failed, computing inline:', (e as Error)?.message)
    }
  }
  return threadMeta(payload.members)
}

export async function associateThread(fragmentId: string): Promise<void> {
  const f = await db.fragments.get(fragmentId)
  if (!f) return
  const others = (await db.fragments.toArray()).filter((o) => o.id !== f.id)

  const plan = await planInWorker(f, others)

  if (plan.action === 'create') {
    await createThreadFor(f)
    return
  }

  let target: string
  if (plan.action === 'merge-join') {
    // bridge merge: a second strong thread means these topics are actually one
    await mergeThreads(plan.from, plan.into)
    target = plan.into
  } else {
    target = plan.threadId
  }

  f.threadId = target
  await db.fragments.put(f)
  await recomputeThreadMeta(target)
}

async function createThreadFor(f: Fragment): Promise<string> {
  const id = crypto.randomUUID()
  const thread: Thread = {
    id,
    createdAt: f.createdAt,
    updatedAt: Date.now(),
    terms: [],
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

export async function recomputeThreadMeta(threadId: string): Promise<void> {
  const thread = await db.threads.get(threadId)
  if (!thread) return
  const members = await db.fragments.where('threadId').equals(threadId).toArray()
  if (!members.length) {
    await db.threads.delete(threadId)
    return
  }

  const meta = await metaInWorker(members)

  thread.terms = meta.terms
  thread.title = meta.title
  thread.summary = meta.summary
  thread.cohesion = meta.cohesion
  thread.confidence = meta.confidence
  thread.updatedAt = Date.now()
  await db.threads.put(thread)
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
 * Neighbor scoring runs in the worker; DB/thread lookups stay here.
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

  const payload = {
    self: toThreadSelf(f),
    others: others.map(toThreadOther),
  }
  let neighborsScored: RelatedScore[]
  const pool = getPool()
  if (pool) {
    try {
      neighborsScored = (await pool.exec<{ neighbors: RelatedScore[] }>('related-scores', payload)).neighbors
    } catch (e) {
      console.warn('[recall] related scoring in worker failed, inline fallback:', (e as Error)?.message)
      neighborsScored = relatedScores(payload).neighbors
    }
  } else {
    neighborsScored = relatedScores(payload).neighbors
  }

  const byId = new Map(others.map((o) => [o.id, o]))
  const neighbors: RelatedFragment[] = []
  for (const n of neighborsScored) {
    const frag = byId.get(n.id)
    if (!frag) continue
    const reason =
      n.reason === 'time'
        ? `saved ${n.minutes < 1 ? 'moments' : `${n.minutes} min`} apart`
        : n.reason === 'thread'
          ? 'same memory thread'
          : 'similar content'
    neighbors.push({ fragment: frag, score: n.score, reason })
  }

  let thread: Thread | undefined
  let threadMembers: Fragment[] | undefined
  let note: string | undefined
  if (f.threadId) {
    thread = await db.threads.get(f.threadId)
    threadMembers = await db.fragments.where('threadId').equals(f.threadId).toArray()
    if (threadMembers.length >= 2) {
      const mins = Math.round(
        (Math.max(...threadMembers.map((m) => m.createdAt)) - Math.min(...threadMembers.map((m) => m.createdAt))) / 60_000
      )
      const span = mins < 90 ? `${mins} minutes` : `${Math.round(mins / 60)} hours`
      const confidence: Confidence = thread?.confidence ?? 'low'
      note = `Likely related to: ${thread?.title ?? 'a topic'} — based on ${threadMembers.length} fragments saved within ${span} (${confidence} confidence)`
    }
  }

  return { neighbors, thread, threadMembers, note }
}
