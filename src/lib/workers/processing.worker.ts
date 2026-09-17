/**
 * Recall — processing worker (the V3 fix).
 *
 * EVERY piece of enrichment compute runs here, never on the UI thread:
 *   - light ops: date/urgency/category extraction, lexical embeddings,
 *     duplicate comparison, thread planning — millisecond-scale text math
 *   - heavy ops: OCR (tesseract.js), transcription (whisper), PDF text
 *     (pdf.js), semantic embeddings (transformers.js) — real on-device models
 *
 * The worker is STATELESS with respect to storage: it receives payloads,
 * computes, replies. Only the main thread touches IndexedDB, so Dexie's
 * live queries keep working unchanged.
 *
 * Intelligence packs are still downloaded ONCE from a CDN and then cached
 * (service worker + browser caches) for fully offline use. Nothing is ever
 * uploaded anywhere.
 */

import { extractDates } from '../pipeline/dates'
import { scoreUrgency } from '../pipeline/urgency'
import { inferCategory } from '../pipeline/category'
import { lexicalVector } from '../ml/lexical'
import { dupeCheck } from '../pipeline/dedupe-core'
import { associatePlan, relatedScores, threadMeta } from '../pipeline/threads-core'
import type {
  DedupeComparePayload,
  EmbedQueryPayload,
  EmbedTextPayload,
  EnrichCategoryPayload,
  EnrichDatesPayload,
  EnrichUrgencyPayload,
  ImageDhashPayload,
  OcrPayload,
  PackDownloadPayload,
  PackProgressMsg,
  PdfExtractPayload,
  RelatedScoresPayload,
  ThreadMetaPayload,
  ThreadPlanPayload,
  TranscribePayload,
  WorkerReply,
  WorkerRequest,
} from './protocol'
import type { ExtractedDate } from '../types'

/* ------------------------------------------------------------------ */
/* worker environment shim                                              */
/* ------------------------------------------------------------------ */

const ctx = self as unknown as {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void
  addEventListener: (type: 'message', handler: (ev: MessageEvent<WorkerRequest>) => void) => void
}

function reply(r: WorkerReply) {
  ctx.postMessage(r)
}

function postProgress(p: PackProgressMsg) {
  ctx.postMessage(p)
}

/* ------------------------------------------------------------------ */
/* remote ESM module loading (CDN packs, cached by the service worker)  */
/* ------------------------------------------------------------------ */

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5'
const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'
const STT_MODEL = 'Xenova/whisper-tiny.en'
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js'
const TESSERACT_WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js'
const TESSERACT_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5'
const TESSDATA = 'https://tessdata.projectnaptha.com/4.0.0'
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs'
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'

type AnyModule = Record<string, unknown>

async function remoteImport(url: string): Promise<AnyModule> {
  const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as AnyModule
  return mod?.default && Object.keys(mod).length === 1 && typeof mod.default === 'object'
    ? (mod.default as AnyModule)
    : mod
}

interface Pipe {
  (input: unknown, opts?: Record<string, unknown>): Promise<unknown>
}
interface TransformersModule {
  pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<Pipe>
  env?: { allowLocalModels?: boolean; useBrowserCache?: boolean }
}
interface OcrWorker {
  recognize: (img: unknown) => Promise<{ data: { text: string } }>
  terminate?: () => Promise<void>
}
interface TesseractModule {
  createWorker: (...args: unknown[]) => Promise<OcrWorker>
}
interface PdfDoc {
  numPages: number
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>
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

interface ProgressItem {
  file?: string
  progress?: number
  loaded?: number
  total?: number
  status?: string
}

/** aggregate multi-file model downloads into 0..1 */
function makeAggregator(pack: 'semantic' | 'voice') {
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
    postProgress({ type: 'pack-progress', id: pack, status: 'downloading', pct, note: data.file.split('/').pop() ?? '' })
  }
}

async function loadTransformers(): Promise<TransformersModule> {
  transformersMod = transformersMod ?? ((await remoteImport(TRANSFORMERS_URL)) as unknown as TransformersModule)
  return transformersMod
}

async function getEmbedder(): Promise<Pipe> {
  if (!embedder) {
    postProgress({ type: 'pack-progress', id: 'semantic', status: 'downloading', pct: 0, note: 'loading model…' })
    const t = await loadTransformers()
    embedder = await t.pipeline('feature-extraction', EMBED_MODEL, {
      dtype: 'q8',
      progress_callback: makeAggregator('semantic'),
    })
  }
  return embedder
}

async function getAsr(): Promise<Pipe> {
  if (!asr) {
    const t = await loadTransformers()
    asr = await t.pipeline('automatic-speech-recognition', STT_MODEL, {
      dtype: 'q8',
      progress_callback: makeAggregator('voice'),
    })
  }
  return asr
}

async function getTesseract(): Promise<OcrWorker> {
  if (!ocrWorker) {
    const mod = await remoteImport(TESSERACT_URL)
    const candidates: unknown[] = [
      mod,
      mod.default,
      (self as unknown as { Tesseract?: unknown }).Tesseract,
    ]
    const T = candidates.find(
      (c): c is TesseractModule => !!c && typeof (c as TesseractModule).createWorker === 'function'
    )
    if (!T) throw new Error('tesseract-load-failed')
    postProgress({ type: 'pack-progress', id: 'vision', status: 'downloading', pct: 0, note: 'loading OCR engine…' })
    // Browsers reject cross-origin worker scripts, so we cannot hand tesseract
    // the CDN URL directly. Fetch the script once (the service worker caches
    // it for offline use) and re-serve it from a same-origin blob URL.
    const scriptUrl = await sameOriginWorkerUrl(TESSERACT_WORKER)
    ocrWorker = await T.createWorker('eng', 1, {
      workerPath: scriptUrl,
      corePath: TESSERACT_CORE,
      langPath: TESSDATA,
      workerBlobURL: false,
    })
  }
  return ocrWorker
}

/** fetch a cross-origin worker script and re-serve it same-origin */
async function sameOriginWorkerUrl(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok) throw new Error(`failed to fetch worker script: ${res.status}`)
  const text = await res.text()
  return URL.createObjectURL(new Blob([text], { type: 'application/javascript' }))
}

async function getPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsMod) {
    const mod = (await remoteImport(PDFJS_URL)) as unknown as PdfJsModule
    // same-origin blob URL for pdf.js's own worker (cross-origin worker
    // scripts are rejected by browsers; the SW caches the fetch offline)
    mod.GlobalWorkerOptions.workerSrc = await sameOriginWorkerUrl(PDFJS_WORKER)
    pdfjsMod = mod
  }
  return pdfjsMod
}

async function embedSemanticOne(text: string): Promise<Float32Array> {
  const pipe = await getEmbedder()
  const out = (await pipe([text], { pooling: 'mean', normalize: true })) as { data: Float32Array; dims: number[] }
  const [n, dim] = out.dims
  return out.data.slice(0, n * dim) as Float32Array
}

async function ocrImage(buffer: ArrayBuffer): Promise<string> {
  const worker = await getTesseract()
  const result = await worker.recognize(new Blob([buffer]))
  return (result?.data?.text ?? '').trim()
}

async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await getPdfJs()
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

async function transcribeAudio(pcm: Float32Array): Promise<string> {
  const pipe = await getAsr()
  const out = (await pipe(pcm, { chunk_length_s: 30, stride_length_s: 5 })) as { text: string }
  return (out?.text ?? '').trim()
}

/** dHash: 9x8 grayscale via OffscreenCanvas -> 64-bit hex (worker-safe) */
async function dhash(buffer: ArrayBuffer): Promise<string> {
  const bmp = await createImageBitmap(new Blob([buffer]))
  const w = 9
  const h = 8
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.drawImage(bmp, 0, 0, w, h)
  const { data } = g.getImageData(0, 0, w, h)
  bmp.close?.()
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
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** warm-up image used when the vision pack is downloaded (worker-safe) */
async function placeholderPng(): Promise<Blob> {
  const c = new OffscreenCanvas(8, 8)
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 8, 8)
  return c.convertToBlob({ type: 'image/png' })
}

/* ------------------------------------------------------------------ */
/* pack download orchestration (runs INSIDE this worker)                */
/* ------------------------------------------------------------------ */

async function downloadPackInWorker(id: PackDownloadPayload['id']): Promise<void> {
  switch (id) {
    case 'semantic': {
      await getEmbedder()
      break
    }
    case 'vision': {
      postProgress({ type: 'pack-progress', id: 'vision', status: 'downloading', pct: 5, note: 'downloading OCR model…' })
      const worker = await getTesseract()
      await worker.recognize(await placeholderPng())
      break
    }
    case 'voice': {
      await getAsr()
      break
    }
    case 'documents': {
      postProgress({ type: 'pack-progress', id: 'documents', status: 'downloading', pct: 40, note: 'loading pdf.js…' })
      await getPdfJs()
      break
    }
  }
}

function dropPacks(): void {
  embedder = null
  asr = null
  ocrWorker = null
  pdfjsMod = null
}

/* ------------------------------------------------------------------ */
/* op router                                                            */
/* ------------------------------------------------------------------ */

type Handler = (payload: never) => Promise<unknown>

const HANDLERS: Record<string, Handler> = {
  ping: async () => ({ pong: true, at: Date.now() }),
  'enrich-dates': async (p) => extractDates((p as unknown as EnrichDatesPayload).text),
  'enrich-urgency': async (p) => {
    const q = p as unknown as EnrichUrgencyPayload
    return scoreUrgency(q.text, q.dates as ExtractedDate[])
  },
  'enrich-category': async (p) => {
    const q = p as unknown as EnrichCategoryPayload
    const r = inferCategory(q.text, q.dates as ExtractedDate[])
    return r ?? null
  },
  'embed-text': async (p) => ({ vector: lexicalVector((p as unknown as EmbedTextPayload).text) }),
  'embed-semantic': async (p) => ({ vector: await embedSemanticOne((p as unknown as EmbedTextPayload).text) }),
  'embed-query': async (p) => {
    const q = p as unknown as EmbedQueryPayload
    return {
      lexical: lexicalVector(q.text),
      semantic: q.semantic ? await embedSemanticOne(q.text) : null,
    }
  },
  ocr: async (p) => ({ text: await ocrImage((p as unknown as OcrPayload).buffer) }),
  'pdf-extract': async (p) => ({ text: await extractPdfText((p as unknown as PdfExtractPayload).buffer) }),
  transcribe: async (p) => ({ text: await transcribeAudio((p as unknown as TranscribePayload).pcm) }),
  'image-dhash': async (p) => ({ hash: await dhash((p as unknown as ImageDhashPayload).buffer) }),
  'dedupe-compare': async (p) => dupeCheck(p as unknown as DedupeComparePayload),
  'thread-plan': async (p) => {
    const q = p as unknown as ThreadPlanPayload
    return associatePlan(q.self, q.others)
  },
  'thread-meta': async (p) => threadMeta((p as unknown as ThreadMetaPayload).members),
  'related-scores': async (p) => relatedScores(p as unknown as RelatedScoresPayload),
  'pack-download': async (p) => {
    await downloadPackInWorker((p as unknown as PackDownloadPayload).id)
    return { ok: true }
  },
  'pack-drop': async () => {
    dropPacks()
    return { ok: true }
  },
}

ctx.addEventListener('message', async (ev) => {
  const req = ev.data
  if (!req || typeof req.id !== 'number' || typeof req.op !== 'string') return
  try {
    const handler = HANDLERS[req.op]
    if (!handler) throw new Error('unknown op: ' + req.op)
    const result = await handler(req.payload as never)
    reply({ id: req.id, ok: true, result })
  } catch (e) {
    console.error('[recall-worker] op failed:', req.op, (e as Error)?.message ?? String(e))
    reply({ id: req.id, ok: false, error: (e as Error)?.message ?? String(e) })
  }
})

console.info('[recall-worker] processing worker ready — all compute off the UI thread (v3.1, workerBlobURL=true)')
