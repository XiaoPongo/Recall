/**
 * Duplicate detection — flag near-identical fragments.
 * Links: normalized URL match. Images: dHash perceptual hash. Text: cosine
 * similarity. All heavy lifting (image hashing, comparisons) runs inside
 * the processing worker; this module only prepares summaries from
 * IndexedDB and applies the result.
 */
import { db } from '../db'
import type { Fragment } from '../types'
import { getPool } from '../workers/pool'
import { dupeCheck, toDedupeOther, toDedupeSelf } from './dedupe-core'
import type { DupeResult } from '../workers/protocol'

/** dHash via OffscreenCanvas inside the worker — never on the UI thread */
async function hashInWorker(f: Fragment): Promise<string | undefined> {
  if (!f.blob) return undefined
  const pool = getPool()
  if (!pool) return undefined
  try {
    const buffer = await f.blob.arrayBuffer()
    const { hash } = await pool.exec<{ hash: string }>('image-dhash', { buffer }, { transfer: [buffer] })
    return hash
  } catch {
    return undefined // hashing failure is non-fatal
  }
}

export async function detectDuplicate(f: Fragment): Promise<void> {
  if (f.type === 'image' && f.blob && !f.perceptualHash) {
    const hash = await hashInWorker(f)
    if (hash) {
      f.perceptualHash = hash
      await db.fragments.put(f)
    }
  }

  const others = (await db.fragments.toArray()).filter((o) => o.id !== f.id)
  const payload = {
    self: toDedupeSelf(f),
    others: others.map(toDedupeOther),
  }

  const pool = getPool()
  let result: DupeResult
  if (pool) {
    result = await pool.exec<DupeResult>('dedupe-compare', payload)
  } else {
    // ancient browsers without Worker support: ms-scale inline compute
    result = dupeCheck(payload)
  }

  if (result.duplicateOf && !f.duplicateOf) {
    f.duplicateOf = result.duplicateOf
    await db.fragments.put(f)
  }
}
