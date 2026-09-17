/**
 * Duplicate detection — flag near-identical fragments.
 * Links: normalized URL match. Images: dHash perceptual hash. Text: cosine similarity.
 */
import { db } from '../db'
import type { Confidence, Fragment } from '../types'
import { cosine } from '../ml/lexical'

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

/** dHash: draw to 9x8 grayscale, compare adjacent pixels -> 64 bits as hex */
export async function perceptualHash(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob)
  const w = 9
  const h = 8
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const gray: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
  }
  let bits = ''
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      bits += gray[y * w + x] < gray[y * w + x + 1] ? '1' : '0'
    }
  }
  bmp.close?.()
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
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

export async function detectDuplicate(f: Fragment): Promise<void> {
  const others = (await db.fragments.toArray()).filter((o) => o.id !== f.id)
  let dup: { id: string; confidence: Confidence } | undefined

  if (f.type === 'link') {
    const mine = normalizeUrl(f.rawContent)
    const hit = others.find((o) => o.type === 'link' && normalizeUrl(o.rawContent) === mine)
    if (hit) dup = { id: hit.id, confidence: 'high' }
  }

  if (!dup && f.type === 'image' && f.blob) {
    if (!f.perceptualHash) {
      try {
        f.perceptualHash = await perceptualHash(f.blob)
        await db.fragments.put(f)
      } catch {
        /* hashing failure is non-fatal */
      }
    }
    if (f.perceptualHash) {
      for (const o of others) {
        if (o.type !== 'image') continue
        if (!o.perceptualHash && o.blob) {
          try {
            o.perceptualHash = await perceptualHash(o.blob)
            await db.fragments.put(o)
          } catch {
            continue
          }
        }
        if (o.perceptualHash) {
          const d = hamming(f.perceptualHash, o.perceptualHash)
          if (d <= 4) {
            dup = { id: o.id, confidence: 'high' }
            break
          }
          if (d <= 8) {
            dup = { id: o.id, confidence: 'medium' }
          }
        }
      }
    }
  }

  if (!dup && f.type === 'text' && f.textContent.length > 40) {
    let best = 0
    let bestId = ''
    for (const o of others) {
      if (o.type !== 'text') continue
      const s = cosine(f.lexicalEmbedding?.vector, o.lexicalEmbedding?.vector)
      if (s > best) {
        best = s
        bestId = o.id
      }
    }
    if (bestId && best >= 0.93) dup = { id: bestId, confidence: 'high' }
    else if (bestId && best >= 0.86) dup = { id: bestId, confidence: 'medium' }
  }

  if (dup && !f.duplicateOf) {
    f.duplicateOf = dup
    await db.fragments.put(f)
  }
}
