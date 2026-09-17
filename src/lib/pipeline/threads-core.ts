/**
 * Memory threads — pure compute core (clustering decisions, titles,
 * cohesion, related-fragment scoring). Runs inside the processing worker;
 * the main thread's threads.ts prepares summaries and applies the plan
 * to IndexedDB.
 */
import type { Confidence, FragmentType } from '../types'
import { salientTerms } from '../ml/lexical'
import type {
  RelatedScore,
  RelatedScoresPayload,
  ThreadMemberSummary,
  ThreadMetaResult,
  ThreadOtherSummary,
  ThreadPlan,
  ThreadSelfSummary,
} from '../workers/protocol'

export const TIME_WINDOW_MS = 45 * 60 * 1000 // fragments saved within 45 minutes
export const STRONG_SIM = 0.42
export const LINK_SIM = 0.30
export const TIME_LINK_SIM = 0.14

/** prefers the semantic pair, falls back to lexical vectors */
export function sim(
  a: Pick<ThreadSelfSummary, 'lex' | 'sem'>,
  b: Pick<ThreadSelfSummary, 'lex' | 'sem'>
): number {
  const sem = cosine(a.sem, b.sem)
  if (sem > 0) return sem
  return cosine(a.lex, b.lex)
}

function cosine(a: Float32Array | null | undefined, b: Float32Array | null | undefined): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export function toThreadSelf(f: {
  id: string
  createdAt: number
  threadId?: string
  lexicalEmbedding?: { vector: Float32Array } | null
  semanticEmbedding?: { vector: Float32Array } | null
}): ThreadSelfSummary {
  return {
    id: f.id,
    createdAt: f.createdAt,
    threadId: f.threadId ?? null,
    lex: f.lexicalEmbedding?.vector ?? null,
    sem: f.semanticEmbedding?.vector ?? null,
  }
}

export function toThreadOther(o: {
  id: string
  createdAt: number
  threadId?: string
  textContent: string
  rawContent: string
  lexicalEmbedding?: { vector: Float32Array } | null
  semanticEmbedding?: { vector: Float32Array } | null
}): ThreadOtherSummary {
  return {
    ...toThreadSelf(o),
    hasText: Boolean(o.textContent || o.rawContent),
  }
}

/** decide whether a fragment joins an existing thread, creates one, or bridges two */
export function associatePlan(
  self: ThreadSelfSummary,
  others: ThreadOtherSummary[]
): ThreadPlan {
  const withText = others.filter((o) => o.hasText)
  if (!withText.length) return { action: 'create' }

  const scored = withText
    .map((o) => {
      const s = sim(self, o)
      const dt = Math.abs(o.createdAt - self.createdAt)
      const timeBoost = dt < TIME_WINDOW_MS ? 0.28 * (1 - dt / TIME_WINDOW_MS) : 0
      return { o, s, dt, total: s + timeBoost }
    })
    .sort((a, b) => b.total - a.total)

  const related = scored
    .filter((x) => x.s >= STRONG_SIM || (x.dt < TIME_WINDOW_MS && x.s >= TIME_LINK_SIM))
    .slice(0, 8)

  if (!related.length) return { action: 'create' }

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

  if (!dominant) return { action: 'create' }

  // bridge merge: a second strong thread means these topics are actually one
  const second = Array.from(threadScores.entries())
    .filter(([k]) => k !== dominant)
    .sort((a, b) => b[1] - a[1])[0]
  if (second && second[1] > bestScore * 0.6) {
    return { action: 'merge-join', from: second[0], into: dominant }
  }
  return { action: 'join', threadId: dominant }
}

function threadHint(members: ThreadMemberSummary[]): string {
  const n = members.length || 1
  const links = members.filter((m) => m.type === 'link' || m.type === 'pdf').length
  const images = members.filter((m) => m.type === 'image').length
  const audio = members.filter((m) => m.type === 'audio').length
  const dated = members.filter((m) => m.hasDates).length
  if (links / n >= 0.5) return 'research'
  if (images / n >= 0.5) return 'references'
  if (audio / n >= 0.5) return 'notes'
  if (dated / n >= 0.5) return 'planning'
  return 'topic'
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

/** auto title / summary / cohesion / confidence for a thread's members */
export function threadMeta(members: ThreadMemberSummary[]): ThreadMetaResult {
  if (!members.length) {
    return { terms: [], title: 'Saved', summary: 'Empty thread', cohesion: 0, confidence: 'low' }
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
    members.slice(0, 20).map((m) => m.text),
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
  const summary =
    `Looks like ${hint === 'research' ? 'research on' : 'a topic about'} “${topTerm}” — ${members.length} ` +
    `fragment${members.length === 1 ? '' : 's'} saved over ${daysLabel} (${confidence} confidence)`

  return { terms, title, summary, cohesion, confidence }
}

/** "Why did I save this?" — neighbor scoring (time window, thread, similarity) */
export function relatedScores(payload: RelatedScoresPayload): { neighbors: RelatedScore[] } {
  const { self, others } = payload
  const out: RelatedScore[] = []
  const windowMs = 25 * 60 * 1000

  for (const o of others) {
    const dt = Math.abs(o.createdAt - self.createdAt)
    const s = sim(self, o)
    if (dt < windowMs && s >= 0.08) {
      out.push({ id: o.id, score: s, reason: 'time', minutes: Math.round(dt / 60_000) })
    } else if (o.threadId && o.threadId === self.threadId) {
      out.push({ id: o.id, score: s, reason: 'thread', minutes: Math.round(dt / 60_000) })
    } else if (s >= 0.4) {
      out.push({ id: o.id, score: s, reason: 'similar', minutes: Math.round(dt / 60_000) })
    }
  }

  out.sort((a, b) => b.score - a.score)
  return { neighbors: out.slice(0, 6) }
}
