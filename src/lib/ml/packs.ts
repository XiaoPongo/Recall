/**
 * Intelligence packs — local, on-device models downloaded ONCE from a CDN
 * during first-run setup, then cached (service worker + browser caches) for
 * fully offline use. Nothing is ever uploaded anywhere.
 *
 * There is always a built-in fallback: the lexical engine (see ./lexical.ts)
 * so capture + keyword search work even with zero packs installed.
 */
import type { PackId, PackInfo, PackStatus } from '../types'
import { getSettings, updateSettings } from '../db'
import { remoteImport, } from './remote'

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
/* transformers.js (embeddings + whisper)                               */
/* ------------------------------------------------------------------ */

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5'
const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'
const STT_MODEL = 'Xenova/whisper-tiny.en'

interface Pipe {
  (input: unknown, opts?: Record<string, unknown>): Promise<unknown>
}

interface TransformersModule {
  pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<Pipe>
  env?: { allowLocalModels?: boolean; useBrowserCache?: boolean }
}

interface OcrWorker {
  recognize: (img: unknown) => Promise<{ data: { text: string } }>
}

interface TesseractGlobal {
  createWorker: (...args: unknown[]) => Promise<OcrWorker>
}

interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> }
}

let transformersMod: TransformersModule | null = null
let embedder: Pipe | null = null
let asr: Pipe | null = null
let ocrWorker: OcrWorker | null = null
let pdfjsMod: PdfJsModule | null = null

interface PdfDoc {
  numPages: number
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>
}

async function loadScript(url: string) {
  if (document.querySelector(`script[data-recall-src="${url}"]`)) return
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.async = true
    s.dataset.recallSrc = url
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('failed to load script: ' + url))
    document.head.appendChild(s)
  })
}

interface ProgressItem {
  file?: string
  progress?: number
  loaded?: number
  total?: number
  status?: string
}

/** aggregate multi-file model downloads into 0..1 */
function makeAggregator(onFile: (pct: number, note: string) => void) {
  const files = new Map<string, { loaded: number; total: number }>()
  return (data: ProgressItem) => {
    if (!data?.file) return
    const f = files.get(data.file) ?? { loaded: 0, total: 0 }
    if (data.total) f.total = data.total
    if (data.loaded) f.loaded = data.loaded
    files.set(data.file, f)
    let loaded = 0
    let total = 0
    files.forEach((v) => {
      loaded += v.loaded
      total += v.total
    })
    const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0
    onFile(pct, data.file.split('/').pop() ?? '')
  }
}

export async function isSemanticReady(): Promise<boolean> {
  return (await getSettings()).packs.semantic === 'ready'
}

/** semantic embed texts -> normalized vectors; throws when pack missing */
export async function embedSemantic(texts: string[]): Promise<Float32Array[]> {
  if (!embedder) {
    const settings = await getSettings()
    if (settings.packs.semantic !== 'ready') throw new Error('semantic-pack-not-ready')
    transformersMod = transformersMod ?? (await loadTransformers())
    emit({ id: 'semantic', status: 'downloading', pct: 0, note: 'loading model…' })
    embedder = await transformersMod.pipeline('feature-extraction', EMBED_MODEL, {
      dtype: 'q8',
      progress_callback: makeAggregator((pct, note) => emit({ id: 'semantic', status: 'downloading', pct, note })),
    })
  }
  const out = (await embedder(texts, { pooling: 'mean', normalize: true })) as { data: Float32Array; dims: number[] }
  const [n, dim] = out.dims
  const results: Float32Array[] = []
  for (let i = 0; i < n; i++) {
    const v = out.data.slice(i * dim, (i + 1) * dim)
    results.push(v as Float32Array)
  }
  return results
}

export async function transcribeAudio(
  pcm16k: Float32Array,
  onProgress?: (pct: number) => void
): Promise<string> {
  if (!asr) {
    transformersMod = transformersMod ?? (await loadTransformers())
    asr = await transformersMod.pipeline('automatic-speech-recognition', STT_MODEL, {
      dtype: 'q8',
      progress_callback: makeAggregator((pct, note) =>
        emit({ id: 'voice', status: 'downloading', pct, note })
      ),
    })
  }
  onProgress?.(30)
  const out = (await asr(pcm16k, { chunk_length_s: 30, stride_length_s: 5 })) as { text: string }
  onProgress?.(90)
  return (out?.text ?? '').trim()
}

/* ------------------------------------------------------------------ */
/* tesseract.js (OCR)                                                   */
/* ------------------------------------------------------------------ */

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'

export async function ocrImage(blob: Blob): Promise<string> {
  if (!ocrWorker) {
    await loadScript(TESSERACT_URL)
    const T = (window as unknown as { Tesseract?: TesseractGlobal }).Tesseract
    if (!T) throw new Error('tesseract-load-failed')
    emit({ id: 'vision', status: 'downloading', pct: 0, note: 'loading OCR engine…' })
    const worker = await T.createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5',
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      logger: (m: { status?: string; progress?: number }) => {
        if (m?.status === 'recognizing text') {
          emit({ id: 'vision', status: 'downloading', pct: (m.progress ?? 0) * 100, note: 'reading image…' })
        }
      },
    })
    ocrWorker = worker
  }
  const result = await ocrWorker.recognize(blob)
  return (result?.data?.text ?? '').trim()
}

/* ------------------------------------------------------------------ */
/* pdf.js (text extraction)                                             */
/* ------------------------------------------------------------------ */

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs'
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = pdfjsMod ?? (await loadPdfJs())
  pdfjsMod = pdfjs
  const doc = await pdfjs.getDocument({ data }).promise
  const parts: string[] = []
  const maxPages = Math.min(doc.numPages, 60)
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    parts.push(
      content.items
        .map((it) => it.str ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  }
  return parts.filter(Boolean).join('\n\n')
}

/* ------------------------------------------------------------------ */
/* pack download orchestration                                          */
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
    switch (id) {
      case 'semantic': {
        transformersMod = transformersMod ?? (await loadTransformers())
        embedder = await transformersMod.pipeline('feature-extraction', EMBED_MODEL, {
          dtype: 'q8',
          progress_callback: makeAggregator((pct, note) => emit({ id: 'semantic', status: 'downloading', pct, note })),
        })
        break
      }
      case 'vision': {
        await loadScript(TESSERACT_URL)
        const T = (window as unknown as { Tesseract?: TesseractGlobal }).Tesseract
        if (!T) throw new Error('tesseract-load-failed')
        emit({ id: 'vision', status: 'downloading', pct: 5, note: 'downloading OCR model…' })
        const worker = await T.createWorker('eng', 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5',
          langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        })
        ocrWorker = worker
        await worker.recognize(await placeholderImage())
        break
      }
      case 'voice': {
        transformersMod = transformersMod ?? (await loadTransformers())
        asr = await transformersMod.pipeline('automatic-speech-recognition', STT_MODEL, {
          dtype: 'q8',
          progress_callback: makeAggregator((pct, note) => emit({ id: 'voice', status: 'downloading', pct, note })),
        })
        break
      }
      case 'documents': {
        emit({ id: 'documents', status: 'downloading', pct: 40, note: 'loading pdf.js…' })
        pdfjsMod = await loadPdfJs()
        break
      }
    }
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

async function loadTransformers(): Promise<TransformersModule> {
  const mod = await remoteImport(TRANSFORMERS_URL, '__recall_transformers')
  return mod as unknown as TransformersModule
}

async function loadPdfJs(): Promise<PdfJsModule> {
  const mod = await remoteImport(PDFJS_URL, '__recall_pdfjs')
  const pdfjs = mod as unknown as PdfJsModule
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER
  return pdfjs
}

async function placeholderImage(): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 8
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 8, 8)
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'))
}

/** drop all cached model files — packs go back to "not downloaded" */
export async function clearPackCaches(): Promise<void> {
  embedder = null
  asr = null
  ocrWorker = null
  pdfjsMod = null
  if ('caches' in window) {
    const names = await caches.keys()
    await Promise.all(names.filter((n) => n.includes('transformers') || n.includes('models')).map((n) => caches.delete(n)))
  }
  // tesseract caches language data in an IndexedDB
  if ('indexedDB' in window && indexedDB.deleteDatabase) {
    try {
      indexedDB.deleteDatabase('tesseract.js')
    } catch { /* non-fatal */ }
  }
  const settings = await getSettings()
  await updateSettings({
    packs: { semantic: 'not-downloaded', vision: 'not-downloaded', voice: 'not-downloaded', documents: 'not-downloaded' },
    packErrors: {},
    setupMode: 'basic',
  })
}
