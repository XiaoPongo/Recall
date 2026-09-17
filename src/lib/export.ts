/**
 * Data export + storage budget. Everything is generated locally and
 * downloaded via a Blob — no network involved.
 */
import { db, getSettings } from './db'
import type { Fragment, Thread } from './types'

export interface ExportPayload {
  app: 'recall'
  version: 1
  exportedAt: string
  settings: unknown
  threads: Thread[]
  fragments: Array<Fragment & { _blobBase64?: string }>
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}

export async function exportAllData(includeBlobs: boolean): Promise<Blob> {
  const [settings, threads, fragments] = await Promise.all([
    getSettings(),
    db.threads.toArray(),
    db.fragments.orderBy('createdAt').toArray(),
  ])
  const out: ExportPayload = {
    app: 'recall',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    threads,
    fragments: [],
  }
  for (const f of fragments) {
    const copy: ExportPayload['fragments'][number] = { ...f, blob: undefined }
    if (includeBlobs && f.blob) {
      copy._blobBase64 = await blobToBase64(f.blob)
    }
    out.fragments.push(copy)
  }
  return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
}

/* ------------------------------------------------------------------ */
/* storage budget                                                       */
/* ------------------------------------------------------------------ */

export interface StorageBreakdown {
  label: string
  bytes: number
  count: number
}

export interface StorageReport {
  usage: number
  quota: number
  breakdown: StorageBreakdown[]
  blobTotal: number
  indexTotal: number
  audioWithTranscript: number
}

function embBytes(e: Fragment['lexicalEmbedding'] | Fragment['semanticEmbedding']): number {
  return e ? e.vector.byteLength + 64 : 0
}

export async function computeStorageReport(): Promise<StorageReport> {
  const fragments = await db.fragments.toArray()
  const groups = new Map<string, StorageBreakdown>()
  let indexTotal = 0
  let audioWithTranscript = 0

  for (const f of fragments) {
    const label = f.type === 'audio' ? 'Voice notes' : f.type === 'image' ? 'Screenshots & images' : f.type === 'pdf' ? 'PDFs' : f.type === 'link' ? 'Links' : 'Text notes'
    const g = groups.get(f.type) ?? { label, bytes: 0, count: 0 }
    g.count++
    g.bytes += (f.blob?.size ?? 0) + (f.thumb?.length ?? 0) * 1.4 // thumb is a dataURL
    groups.set(f.type, g)

    indexTotal += embBytes(f.lexicalEmbedding) + embBytes(f.semanticEmbedding)
    if (f.type === 'audio' && f.textContent && f.textContent.length > 3 && f.blob) audioWithTranscript++
  }
  if (!groups.get('text')) {
    groups.set('text', { label: 'Text notes', bytes: 0, count: 0 })
  }

  let usage = 0
  let quota = 0
  try {
    const est = await navigator.storage?.estimate?.()
    usage = est?.usage ?? 0
    quota = est?.quota ?? 0
  } catch { /* not available */ }

  return {
    usage,
    quota,
    breakdown: Array.from(groups.values()).sort((a, b) => b.bytes - a.bytes),
    blobTotal: Array.from(groups.values()).reduce((s, g) => s + g.bytes, 0),
    indexTotal,
    audioWithTranscript,
  }
}

/** storage-saver: drop original audio files that already have transcripts */
export async function dropTranscribedAudio(): Promise<number> {
  const fragments = await db.fragments.toArray()
  let dropped = 0
  for (const f of fragments) {
    if (f.type === 'audio' && f.blob && (f.textContent || '').trim().length > 3 && !f.audioDropped) {
      f.blob = undefined
      f.audioDropped = true
      await db.fragments.put(f)
      dropped++
    }
  }
  return dropped
}
