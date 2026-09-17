/**
 * Recall — core domain types.
 * All data lives on-device in IndexedDB. No server, no accounts, no cloud.
 */

export type FragmentType = 'text' | 'link' | 'image' | 'pdf' | 'audio'

/** Confidence attached to EVERY extracted field — never present inference as fact. */
export type Confidence = 'high' | 'medium' | 'low'

export interface ExtractedDate {
  /** ISO string of the parsed date */
  date: string
  /** The text span it was parsed from, e.g. "Friday 5pm" */
  source: string
  confidence: Confidence
}

export type UrgencyLevel = 'high' | 'medium' | 'low' | 'none'

export interface UrgencyInfo {
  level: UrgencyLevel
  /** 0–100 */
  score: number
  signals: string[]
  confidence: Confidence
}

export interface CategoryInfo {
  label: CategoryLabel
  confidence: Confidence
}

export type CategoryLabel =
  | 'meeting'
  | 'deadline'
  | 'task'
  | 'purchase'
  | 'reference'
  | 'idea'
  | 'note'

export type JobStep =
  | 'extract-pdf'
  | 'ocr'
  | 'transcribe'
  | 'dates'
  | 'urgency'
  | 'category'
  | 'embed'
  | 'embed-semantic'
  | 'dedupe'
  | 'thread'

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked'

export interface ProcessingState {
  /** overall pipeline status for this fragment */
  status: 'raw' | 'processing' | 'ready' | 'partial'
  steps: Partial<Record<JobStep, StepStatus>>
  lastError?: string
}

export interface Embedding {
  model: 'lexical' | 'semantic'
  dim: number
  vector: Float32Array
}

export interface Fragment {
  id: string
  type: FragmentType
  createdAt: number
  /** the raw payload as saved: text body / URL / filename */
  rawContent: string
  /** searchable text — raw content + OCR/transcript/PDF text once processed */
  textContent: string
  /** binary payload for image/pdf/audio (IndexedDB-native Blob) */
  blob?: Blob
  /** thumbnail data-url for images (generated locally) */
  thumb?: string
  mimeType?: string
  /** where it came from: 'manual', 'share-target', 'paste', 'recorder', 'seed' */
  origin: string
  /** referrer info when available */
  originNote?: string
  processing: ProcessingState
  extracted: {
    dates: ExtractedDate[]
    urgency: UrgencyInfo
    category?: CategoryInfo
  }
  /** lexical embedding always exists (instant); semantic when the pack is active */
  lexicalEmbedding?: Embedding
  semanticEmbedding?: Embedding
  threadId?: string
  /** set when a near-identical fragment was saved before */
  duplicateOf?: { id: string; confidence: Confidence }
  /** "Forget this topic" — excluded from resurfacing, data kept */
  suppressed?: boolean
  /** dismissed from resurfacing — never resurface again */
  dismissedAt?: number
  /** snoozed from resurfacing until */
  snoozedUntil?: number
  /** resurfacing bookkeeping */
  lastSurfacedAt?: number
  notifiedAt?: number
  openCount?: number
  lastOpenedAt?: number
  /** per-fragment "never process" memory boundary */
  neverProcess?: boolean
  /** dHash perceptual hash for image duplicate detection (computed on-device) */
  perceptualHash?: string
  /** original audio dropped after transcription (storage saver) */
  audioDropped?: boolean
  title?: string
}

export interface Thread {
  id: string
  createdAt: number
  updatedAt: number
  /** auto-generated topic terms, e.g. ["laptop","research","prices"] */
  terms: string[]
  title: string
  summary: string
  confidence: Confidence
  /** cohesion 0–1 of member fragments */
  cohesion: number
  suppressed?: boolean
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface Job {
  id?: number
  fragmentId: string
  type: JobStep
  status: JobStatus
  attempts: number
  maxAttempts: number
  error?: string
  createdAt: number
  updatedAt: number
  /** small priority int — lower runs first (observability; scheduling uses lanes) */
  priority: number
  /** 'light' jobs (ms-scale text math) always run before 'heavy' (model) jobs */
  lane?: 'light' | 'heavy'
  /** when this job was dispatched (queue observability) */
  startedAt?: number
}

export type PackId = 'semantic' | 'vision' | 'voice' | 'documents'

export interface PackInfo {
  id: PackId
  name: string
  description: string
  /** approximate download size shown to the user */
  approxMB: number
  requires: string[]
}

export type PackStatus = 'not-downloaded' | 'downloading' | 'ready' | 'error'

export interface BoundaryRule {
  id: string
  /** 'type' (fragment type) or 'source' (origin/domain substring) */
  kind: 'type' | 'source'
  value: string
  createdAt: number
}

export interface AppSettings {
  setupComplete: boolean
  setupMode: 'basic' | 'enhanced'
  packs: Record<PackId, PackStatus>
  packErrors: Partial<Record<PackId, string>>
  /** opt-in deadline notifications via Notification API (where supported) */
  notificationsEnabled: boolean
  /** opt-in "on this day" resurfacing — off by default */
  onThisDay: boolean
  lastDigestAt?: number
  boundaryRules: BoundaryRule[]
  theme?: 'light' | 'dark' | 'system'
  installHintDismissed?: boolean
}

export interface SearchFilters {
  types?: FragmentType[]
  /** 'deadlines' | 'meetings' are derived lenses, not types */
  lens?: 'all' | FragmentType[] | 'deadlines' | 'meetings' | 'unprocessed'
  timeWindow?: { from: number; to: number }
}

export interface SearchHit {
  fragment: Fragment
  score: number
  /** why this matched — shown in UI */
  reasons: string[]
}

export type ResurfaceReason =
  | 'deadline-soon'
  | 'weekly-digest'
  | 'decay'
  | 'on-this-day'

export interface ResurfaceItem {
  fragment: Fragment
  reason: ResurfaceReason
  note: string
}
