/**
 * Intelligence packs — local, on-device models downloaded ONCE from a CDN
 * during first-run setup, then cached (service worker + browser caches) for
 * fully offline use. Nothing is ever uploaded anywhere.
 *
 * V3: the packs now live INSIDE the processing worker. downloadPack() asks
 * a pinned worker to load the model there, so setup, OCR, transcription
 * and semantic search never touch the UI thread.
 *
 * There is always a built-in fallback: the lexical engine (see ./lexical.ts)
 * so capture + keyword search work even with zero packs installed.
 */
import type { PackId, PackInfo, PackStatus } from '../types'
import { getSettings, updateSettings } from '../db'
import { getPool } from '../workers/pool'
import type { PackProgressMsg } from '../workers/protocol'

export const PACKS: PackInfo[] = [
  {
    id: 'semantic',
    name: 'Semantic search',
    description: 'Understands meaning, not just keywords — finds "that laptop fixing article".',
    approxMB: 23,
    requires: ['all-MiniLM-L6-v2 sentence embeddings'],
  },
  {
    id: 'vision',
    name: 'Image text recognition (OCR)',
    description: 'Reads text inside screenshots and photos so they become searchable.',
    approxMB: 15,
    requires: ['tesseract.js + English model'],
  },
  {
    id: 'voice',
    name: 'Voice transcription',
    description: 'Transcribes voice notes on-device (Whisper tiny, English).',
    approxMB: 42,
    requires: ['whisper-tiny.en'],
  },
  {
    id: 'documents',
    name: 'PDF text extraction',
    description: 'Reads text out of PDFs so they become searchable.',
    approxMB: 4,
    requires: ['pdf.js'],
  },
]

/* ------------------------------------------------------------------ */
/* progress events (setup wizard + settings listen)                     */
/* ------------------------------------------------------------------ */

export interface PackProgress {
  id: PackId
  status: 'downloading' | 'ready' | 'error'
  pct: number
  note?: string
}

type Listener = (p: PackProgress) => void
const listeners = new Set<Listener>()
export function subscribePackProgress(fn: Listener): () => void {
  // make sure worker-side progress messages reach our listeners
  const pool = getPool()
  if (pool && !pool.onPackProgress) {
    pool.onPackProgress = (msg: PackProgressMsg) => {
      if (msg.type === 'pack-progress') emit({ id: msg.id, status: msg.status, pct: msg.pct, note: msg.note })
    }
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
function emit(p: PackProgress) {
  listeners.forEach((l) => l(p))
}

export function packStatusFromSettings(id: PackId, packs: Record<PackId, PackStatus>): PackStatus {
  return packs[id] ?? 'not-downloaded'
}

/* ------------------------------------------------------------------ */
/* pack download orchestration (executed inside the worker)            */
/* ------------------------------------------------------------------ */

export async function downloadPack(id: PackId): Promise<void> {
  const settings = await getSettings()
  if (settings.packs[id] === 'ready' || settings.packs[id] === 'downloading') return
  await updateSettings({
    packs: { ...settings.packs, [id]: 'downloading' },
    packErrors: { ...settings.packErrors, [id]: undefined },
  })
  emit({ id, status: 'downloading', pct: 0, note: 'starting…' })
  try {
    const pool = getPool()
    if (!pool) throw new Error('workers-unavailable')
    // pinned slot so the loaded model singletons stay on worker 0
    await pool.exec('pack-download', { id }, { affinity: 'pinned' })
    const after = await getSettings()
    await updateSettings({ packs: { ...after.packs, [id]: 'ready' } })
    emit({ id, status: 'ready', pct: 100 })
  } catch (e) {
    const msg = (e as Error)?.message ?? 'download failed'
    const after = await getSettings()
    await updateSettings({
      packs: { ...after.packs, [id]: 'error' },
      packErrors: { ...after.packErrors, [id]: msg },
    })
    emit({ id, status: 'error', pct: 0, note: msg })
    throw e
  }
}

/** drop all cached model files — packs go back to "not downloaded" */
export async function clearPackCaches(): Promise<void> {
  // tell workers to forget their model singletons
  const pool = getPool()
  if (pool) {
    try {
      await pool.exec('pack-drop', {})
    } catch {
      /* non-fatal */
    }
  }
  if (typeof window !== 'undefined' && 'caches' in window) {
    const names = await caches.keys()
    await Promise.all(
      names.filter((n) => n.includes('transformers') || n.includes('models')).map((n) => caches.delete(n))
    )
  }
  // tesseract caches language data in an IndexedDB
  if (typeof window !== 'undefined' && 'indexedDB' in window && indexedDB.deleteDatabase) {
    try {
      indexedDB.deleteDatabase('tesseract.js')
    } catch {
      /* non-fatal */
    }
  }
  const settings = await getSettings()
  await updateSettings({
    packs: { semantic: 'not-downloaded', vision: 'not-downloaded', voice: 'not-downloaded', documents: 'not-downloaded' },
    packErrors: {},
    setupMode: 'basic',
  })
}
