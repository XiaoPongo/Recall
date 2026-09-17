/**
 * Worker protocol shared by the main thread (pool + queue) and the
 * processing worker. Pure types + lane classification — importable from
 * both bundles without pulling in any DOM or DB dependencies.
 */

import type { Confidence, FragmentType, JobStep, PackId, UrgencyInfo, ExtractedDate, CategoryInfo } from '../types'

/* ------------------------------------------------------------------ */
/* lanes                                                                */
/* ------------------------------------------------------------------ */

export type Lane = 'light' | 'heavy'

/**
 * Heavy steps run real on-device models (OCR / transcription / PDF /
 * semantic embeddings). Everything else is millisecond-scale text math.
 * The scheduler ALWAYS dispatches light work first so a queued OCR can
 * never delay the dates extraction of a plain note.
 */
export const HEAVY_STEPS: readonly JobStep[] = ['ocr', 'transcribe', 'extract-pdf', 'embed-semantic']

export function stepLane(step: JobStep): Lane {
  return HEAVY_STEPS.includes(step) ? 'heavy' : 'light'
}

/* ------------------------------------------------------------------ */
/* request / reply envelopes                                            */
/* ------------------------------------------------------------------ */

export interface WorkerRequest {
  id: number
  op: WorkerOpName
  payload: unknown
}

export interface WorkerReply {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

/** unsolicited progress messages (model pack downloads) */
export interface PackProgressMsg {
  type: 'pack-progress'
  id: PackId
  status: 'downloading' | 'ready' | 'error'
  pct: number
  note?: string
}

export type WorkerOpName =
  | 'ping'
  | 'enrich-dates'
  | 'enrich-urgency'
  | 'enrich-category'
  | 'embed-text'
  | 'embed-semantic'
  | 'embed-query'
  | 'ocr'
  | 'pdf-extract'
  | 'transcribe'
  | 'image-dhash'
  | 'dedupe-compare'
  | 'thread-plan'
  | 'thread-meta'
  | 'related-scores'
  | 'pack-download'
  | 'pack-drop'

/* ------------------------------------------------------------------ */
/* op payloads + results                                                */
/* ------------------------------------------------------------------ */

export interface EnrichDatesPayload {
  text: string
}
export interface EnrichUrgencyPayload {
  text: string
  dates: ExtractedDate[]
}
export interface EnrichCategoryPayload {
  text: string
  dates: ExtractedDate[]
}
export interface EmbedTextPayload {
  text: string
}
export interface EmbedQueryPayload {
  text: string
  /** false when the semantic pack is absent — returns lexical only */
  semantic: boolean
}
export interface OcrPayload {
  buffer: ArrayBuffer
}
export interface PdfExtractPayload {
  buffer: ArrayBuffer
}
export interface TranscribePayload {
  pcm: Float32Array
}
export interface ImageDhashPayload {
  buffer: ArrayBuffer
}

export interface VectorResult {
  vector: Float32Array
}
export interface EmbedQueryResult {
  lexical: Float32Array
  semantic: Float32Array | null
}
export interface TextResult {
  text: string
}
export interface HashResult {
  hash: string
}

/* ---- dedupe ------------------------------------------------------- */

export interface DedupeSelfSummary {
  type: FragmentType
  /** raw URL for links */
  url: string
  /** textContent for length checks */
  text: string
  hash: string | null
  vector: Float32Array | null
}
export interface DedupeOtherSummary {
  id: string
  type: FragmentType
  url: string
  hash: string | null
  vector: Float32Array | null
}
export interface DedupeComparePayload {
  self: DedupeSelfSummary
  others: DedupeOtherSummary[]
}
export interface DupeResult {
  duplicateOf?: { id: string; confidence: Confidence }
}

/* ---- threads ------------------------------------------------------ */

export interface ThreadSelfSummary {
  id: string
  createdAt: number
  threadId: string | null
  lex: Float32Array | null
  sem: Float32Array | null
}
export interface ThreadOtherSummary extends ThreadSelfSummary {
  hasText: boolean
}
export interface ThreadPlanPayload {
  self: ThreadSelfSummary
  others: ThreadOtherSummary[]
}
export type ThreadPlan =
  | { action: 'create' }
  | { action: 'join'; threadId: string }
  | { action: 'merge-join'; from: string; into: string }

export interface ThreadMemberSummary {
  text: string
  type: FragmentType
  createdAt: number
  hasDates: boolean
  lex: Float32Array | null
  sem: Float32Array | null
}
export interface ThreadMetaPayload {
  members: ThreadMemberSummary[]
}
export interface ThreadMetaResult {
  terms: string[]
  title: string
  summary: string
  cohesion: number
  confidence: Confidence
}

export interface RelatedScoresPayload {
  self: ThreadSelfSummary
  others: ThreadOtherSummary[]
}
export interface RelatedScore {
  id: string
  score: number
  reason: 'time' | 'thread' | 'similar'
  /** minutes between the two fragments' creation (for the time reason) */
  minutes: number
}
export interface RelatedScoresResult {
  neighbors: RelatedScore[]
}

/* ---- packs -------------------------------------------------------- */

export interface PackDownloadPayload {
  id: PackId
}

/* ---- enrich results (mirror the pure analyzers' shapes) ----------- */

export type EnrichDatesResult = ExtractedDate[]
export type EnrichUrgencyResult = UrgencyInfo
export type EnrichCategoryResult = CategoryInfo | null
