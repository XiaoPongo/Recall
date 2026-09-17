/**
 * Duplicate detection — pure compute core.
 * Runs inside the processing worker (never on the UI thread); the main
 * thread's dedupe.ts only prepares summaries and applies the result.
 */
import type { Confidence, FragmentType } from '../types'
import type { DedupeComparePayload, DedupeOtherSummary, DedupeSelfSummary, DupeResult } from '../workers/protocol'

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    const junk = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source']
    junk.forEach((p) => u.searchParams.delete(p))
    u.hash = ''
    let s = u.toString()
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

function hamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    d += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1)
  }
  return d
}

function cosine(a: Float32Array | null | undefined, b: Float32Array | null | undefined): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export function toDedupeSelf(f: {
  type: FragmentType
  rawContent: string
  textContent: string
  perceptualHash?: string
  lexicalEmbedding?: { vector: Float32Array } | null
}): DedupeSelfSummary {
  return {
    type: f.type,
    url: f.rawContent,
    text: f.textContent ?? '',
    hash: f.perceptualHash ?? null,
    vector: f.lexicalEmbedding?.vector ?? null,
  }
}

export function toDedupeOther(o: {
  id: string
  type: FragmentType
  rawContent: string
  perceptualHash?: string
  lexicalEmbedding?: { vector: Float32Array } | null
}): DedupeOtherSummary {
  return {
    id: o.id,
    type: o.type,
    url: o.rawContent,
    hash: o.perceptualHash ?? null,
    vector: o.lexicalEmbedding?.vector ?? null,
  }
}

/**
 * Pure comparison — port of the original detectDuplicate logic.
 * (The old code hashed other images on the fly; hashing now happens as
 * part of each fragment's own dedupe step, so others without a hash are
 * simply skipped here.)
 */
export function dupeCheck(payload: DedupeComparePayload): DupeResult {
  const { self, others } = payload
  let dup: { id: string; confidence: Confidence } | undefined

  if (self.type === 'link') {
    const mine = normalizeUrl(self.url)
    const hit = others.find((o) => o.type === 'link' && normalizeUrl(o.url) === mine)
    if (hit) dup = { id: hit.id, confidence: 'high' }
  }

  if (!dup && self.type === 'image' && self.hash) {
    for (const o of others) {
      if (o.type !== 'image' || !o.hash) continue
      const d = hamming(self.hash, o.hash)
      if (d <= 4) {
        dup = { id: o.id, confidence: 'high' }
        break
      }
      if (d <= 8) {
        dup = { id: o.id, confidence: 'medium' }
      }
    }
  }

  if (!dup && self.type === 'text' && self.text.length > 40) {
    let best = 0
    let bestId = ''
    for (const o of others) {
      if (o.type !== 'text') continue
      const s = cosine(self.vector, o.vector)
      if (s > best) {
        best = s
        bestId = o.id
      }
    }
    if (bestId && best >= 0.93) dup = { id: bestId, confidence: 'high' }
    else if (bestId && best >= 0.86) dup = { id: bestId, confidence: 'medium' }
  }

  return { duplicateOf: dup }
}
