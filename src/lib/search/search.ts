/**
 * Hybrid search — deliberately NOT pure vector search.
 * Combines: semantic similarity + keyword matching + recency + type match +
 * thread relevance + urgency match, plus natural-language time windows
 * ("last week", "around when I saved the Tokyo stuff").
 */
import type { Fragment, FragmentType, SearchHit, Thread } from '../types'
import { cosine, lexicalVector, stemLite, tokenize, words } from '../ml/lexical'
import { embedSemantic } from '../ml/packs'
import { parseAnchorQuery, parseTimeExpression, type TimeWindow } from './timeparse'
import { isExcludedFromProcessing } from '../db'
import { nearestFutureDateMs } from '../pipeline/dates'

export interface SearchOptions {
  lens?: 'all' | FragmentType | 'deadlines' | 'meetings' | 'unprocessed'
  timeWindow?: TimeWindow | null
  semanticReady: boolean
  boundaryRules: Parameters<typeof isExcludedFromProcessing>[1]
}

const TYPE_HINTS: [RegExp, FragmentType][] = [
  [/\b(screenshots?|images?|photos?|pictures?)\b/, 'image'],
  [/\bpdfs?\b|\bdocuments?\b/, 'pdf'],
  [/\b(links?|urls?|websites?|sites?)\b/, 'link'],
  [/\b(voice|audio|recordings?|memos?)\b/, 'audio'],
]
const URGENT_RE = /\b(deadlines?|due|urgent|asap|meetings?|todo|to-dos?|tasks?|remember|upcoming)\b/i

function idfMap(fragments: Fragment[], queryTokens: string[]): Map<string, number> {
  const n = Math.max(1, fragments.length)
  const df = new Map<string, number>()
  for (const t of queryTokens) {
    let d = 0
    for (const f of fragments) {
      if (textTokenSet(f).has(t)) d++
    }
    df.set(t, d)
  }
  const out = new Map<string, number>()
  df.forEach((d, t) => out.set(t, Math.log(1 + n / (1 + d))))
  return out
}

const tokenSetCache = new WeakMap<Fragment, Set<string>>()
function textTokenSet(f: Fragment): Set<string> {
  let s = tokenSetCache.get(f)
  if (!s) {
    s = new Set(tokenize(`${f.rawContent} ${f.textContent}`))
    tokenSetCache.set(f, s)
  }
  return s
}

export async function searchFragments(
  rawQuery: string,
  fragments: Fragment[],
  threads: Thread[],
  opts: SearchOptions
): Promise<{ hits: SearchHit[]; timeWindow?: TimeWindow; anchored?: boolean }> {
  const boundaryExcluded = new Set(fragments.filter((f) => isExcludedFromProcessing(f, opts.boundaryRules)).map((f) => f.id))

  let timeWindow = opts.timeWindow ?? null
  let anchored = false
  let q = rawQuery.trim()

  // anchor mode — "around when I saved the Tokyo stuff"
  const anchor = parseAnchorQuery(q)
  let working = q
  if (anchor) {
    anchored = true
    working = anchor
    const qv = lexicalVector(anchor)
    const scored = fragments
      .filter((f) => !boundaryExcluded.has(f.id))
      .map((f) => ({ f, s: cosine(qv, f.lexicalEmbedding?.vector) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .filter((x) => x.s > 0.12)
    if (scored.length) {
      const times = scored.map((x) => x.f.createdAt)
      const min = Math.min(...times)
      const max = Math.max(...times)
      timeWindow = { from: min - 36 * 3_600_000, to: max + 36 * 3_600_000, label: 'around that time' }
      working = anchor
    }
  }

  const timeExpr = timeWindow ?? parseTimeExpression(q)
  if (timeExpr && !anchored) timeWindow = timeExpr

  const queryLower = working.toLowerCase()
  const typeHints: FragmentType[] = []
  for (const [re, t] of TYPE_HINTS) {
    if (re.test(queryLower)) typeHints.push(t)
  }
  const urgent = URGENT_RE.test(working)

  // strip time/anchor/type words for the semantic payload
  const cleanQuery = working
    .replace(/\b(when i saved|around (when |the )?(time )?i (saved|kept)|back when i (saved|kept))\s+/gi, ' ')
    .replace(/\b(last|past)\s+\d+\s+(day|days|week|weeks|month|months)\b/gi, ' ')
    .replace(/\b(today|yesterday|this week|last week|this month|last month)\b/gi, ' ')
    .replace(/\b(screenshots?|images?|photos?|pictures?|pdfs?|documents?|links?|urls?|websites?|sites?|voice|audio|recordings?|memos?)\b/gi, ' ')
    .trim()

  const queryTokens = tokenize(cleanQuery || working)
  const qLex = lexicalVector(working)

  let qSem: Float32Array | null = null
  if (opts.semanticReady && cleanQuery) {
    try {
      ;[qSem] = await embedSemantic([cleanQuery])
    } catch {
      qSem = null
    }
  }

  const idf = idfMap(fragments, queryTokens)
  const idfSum = Array.from(idf.values()).reduce((a, b) => a + b, 0) || 1

  const now = Date.now()
  const threadById = new Map(threads.map((t) => [t.id, t]))

  const hits: SearchHit[] = []

  for (const f of fragments) {
    // hard filters -------------------------------------------------------
    if (opts.lens && opts.lens !== 'all' && !lensMatch(f, opts.lens)) continue
    if (timeWindow && (f.createdAt < timeWindow.from || f.createdAt > timeWindow.to)) continue

    if (!cleanQuery) {
      hits.push({ fragment: f, score: 1, reasons: [] })
      continue
    }

    // boundary items are excluded from the search index entirely
    if (boundaryExcluded.has(f.id)) continue

    // scoring ------------------------------------------------------------
    const tokens = textTokenSet(f)

    // keyword (BM25-lite with fuzzy prefix credit)
    let kwRaw = 0
    const matchedTokens: string[] = []
    for (const qt of queryTokens) {
      const w = idf.get(qt) ?? 0
      let tf = 0
      if (tokens.has(qt)) {
        tf = 1
        matchedTokens.push(qt)
      } else if (qt.length >= 4) {
        // prefix / partial stem match — "fixing" ≈ "fixed"
        let partial = false
        for (const t of tokens) {
          if (t.length >= 4 && (t.startsWith(qt.slice(0, 4)) || qt.startsWith(t.slice(0, 4)))) {
            partial = true
            break
          }
        }
        if (partial) {
          tf = 0.55
          matchedTokens.push(qt)
        }
      }
      kwRaw += w * tf
    }
    const kw = Math.min(1, kwRaw / idfSum)

    // semantic (fall back to lexical for fragments lacking semantic vectors)
    const semCos = qSem ? cosine(qSem, f.semanticEmbedding?.vector) : 0
    const lex = cosine(qLex, f.lexicalEmbedding?.vector)
    const sem = qSem ? (f.semanticEmbedding ? semCos : lex * 0.85) : lex

    // exact phrase / url
    const hay = `${f.rawContent} ${f.textContent}`.toLowerCase()
    const phrase = cleanQuery.length >= 6 && hay.includes(cleanQuery) ? 1 : 0
    const urlHit = /^https?:\/\//.test(cleanQuery) && f.type === 'link' && f.rawContent.toLowerCase().includes(cleanQuery.replace(/\/$/, '')) ? 1 : 0

    // recency — gentle, exp decay ~2 week half-life
    const ageDays = (now - f.createdAt) / 86_400_000
    const rec = Math.exp(-ageDays / 21)

    // thread relevance
    let thr = 0
    if (f.threadId) {
      const t = threadById.get(f.threadId)
      if (t) {
        const tt = new Set([...t.terms.map(stemLite), ...tokenize(t.title)])
        const hitsN = queryTokens.filter((qt) => tt.has(qt)).length
        thr = queryTokens.length ? hitsN / queryTokens.length : 0
      }
    }

    // urgency / deadline match
    let urg = 0
    if (urgent) {
      const nearest = nearestFutureDateMs(f.extracted.dates ?? [])
      if (nearest) urg = 0.5
      if (f.extracted.urgency.level === 'medium') urg = Math.max(urg, 0.6)
      if (f.extracted.urgency.level === 'high') urg = 1
    }

    // type match (query mentions a type)
    const typeMatch = typeHints.length ? (typeHints.includes(f.type) ? 1 : 0) : 0

    const score =
      0.34 * sem + 0.24 * kw + 0.10 * (phrase || urlHit) + 0.08 * rec + 0.08 * thr + 0.06 * urg + 0.10 * typeMatch

    if (score < 0.06 && !matchedTokens.length && !urlHit) continue

    const reasons: string[] = []
    if (sem > 0.45) reasons.push(qSem && f.semanticEmbedding ? 'semantic match' : 'content match')
    if (matchedTokens.length) reasons.push(`keyword: ${matchedTokens.slice(0, 3).join(', ')}`)
    if (urlHit) reasons.push('exact link')
    else if (phrase) reasons.push('exact phrase')
    if (typeMatch) reasons.push(`type: ${f.type}`)
    if (thr > 0.3) reasons.push(`thread: ${threadById.get(f.threadId!)?.title ?? ''}`)
    if (urg > 0.5) reasons.push('time-sensitive')
    if (rec > 0.6) reasons.push('recent')

    hits.push({ fragment: f, score, reasons })
  }

  hits.sort((a, b) => b.score - a.score || b.fragment.createdAt - a.fragment.createdAt)
  return { hits: hits.slice(0, 60), timeWindow: timeWindow ?? undefined, anchored }
}

function lensMatch(f: Fragment, lens: SearchOptions['lens']): boolean {
  if (!lens || lens === 'all') return true
  if (lens === 'deadlines') {
    const nearest = nearestFutureDateMs(f.extracted.dates ?? [])
    return Boolean(nearest) || f.extracted.urgency.level === 'high' || f.extracted.urgency.level === 'medium'
  }
  if (lens === 'meetings') return f.extracted.category?.label === 'meeting'
  if (lens === 'unprocessed') return f.processing.status === 'processing' || f.processing.status === 'raw'
  return f.type === lens
}

/** browse-mode list for a lens, newest first */
export function browseFragments(fragments: Fragment[], lens: SearchOptions['lens']): Fragment[] {
  return fragments
    .filter((f) => lensMatch(f, lens))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function countByLens(fragments: Fragment[]): Record<string, number> {
  const counts: Record<string, number> = { all: fragments.length }
  for (const lens of ['text', 'link', 'image', 'pdf', 'audio', 'deadlines', 'meetings'] as const) {
    counts[lens] = fragments.filter((f) => lensMatch(f, lens)).length
  }
  return counts
}

/** tiny helper reused by export copy */
export function extractSnippet(f: Fragment, len = 180): string {
  const t = (f.textContent || f.rawContent || '').replace(/\s+/g, ' ').trim()
  return t.length > len ? t.slice(0, len) + '…' : t
}

export { words }
