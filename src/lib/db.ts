/**
 * Local database — everything lives in IndexedDB on this device.
 * Dexie is a thin wrapper over IndexedDB; it works unchanged inside Capacitor.
 */
import Dexie, { type Table } from 'dexie'
import type { AppSettings, Fragment, Job, Thread } from './types'

export class RecallDB extends Dexie {
  fragments!: Table<Fragment, string>
  threads!: Table<Thread, string>
  jobs!: Table<Job, number>
  settings!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('recall-db')
    this.version(1).stores({
      // only index what we query by; blobs/vectors are stored inline
      fragments: 'id, createdAt, type, threadId, suppressed, dismissedAt, snoozedUntil, *extracted.urgency.level',
      threads: 'id, updatedAt',
      jobs: '++id, fragmentId, type, status, priority',
      settings: 'key',
    })
  }
}

export const db = new RecallDB()

/* ------------------------------------------------------------------ */
/* Settings helpers                                                     */
/* ------------------------------------------------------------------ */

const SETTINGS_KEY = 'app'

export const DEFAULT_SETTINGS: AppSettings = {
  setupComplete: false,
  setupMode: 'basic',
  packs: {
    semantic: 'not-downloaded',
    vision: 'not-downloaded',
    voice: 'not-downloaded',
    documents: 'not-downloaded',
  },
  packErrors: {},
  notificationsEnabled: false,
  onThisDay: false,
  boundaryRules: [],
}

export async function getSettings(): Promise<AppSettings> {
  const row = await db.settings.get(SETTINGS_KEY)
  if (!row) return { ...DEFAULT_SETTINGS }
  // merge to survive schema evolution
  return { ...DEFAULT_SETTINGS, ...(row.value as AppSettings), packs: { ...DEFAULT_SETTINGS.packs, ...((row.value as AppSettings).packs ?? {}) } }
}

export async function saveSettings(next: AppSettings) {
  await db.settings.put({ key: SETTINGS_KEY, value: next })
}

export async function updateSettings(patch: Partial<AppSettings>) {
  const cur = await getSettings()
  const next = { ...cur, ...patch }
  await saveSettings(next)
  return next
}

/* ------------------------------------------------------------------ */
/* Memory boundary ("never process") — rules checked by every job       */
/* ------------------------------------------------------------------ */

import type { BoundaryRule } from './types'

/** true when a fragment must be excluded from ALL automated processing + search index */
export function isExcludedFromProcessing(
  fragment: Pick<Fragment, 'type' | 'origin' | 'rawContent' | 'neverProcess'>,
  rules: BoundaryRule[]
): boolean {
  if (fragment.neverProcess) return true
  for (const r of rules) {
    if (r.kind === 'type' && r.value === fragment.type) return true
    if (r.kind === 'source') {
      const hay = `${fragment.origin} ${fragment.rawContent}`.toLowerCase()
      if (hay.includes(r.value.toLowerCase())) return true
    }
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Share-target inbox (separate tiny DB written by the service worker)  */
/* ------------------------------------------------------------------ */

/**
 * The service worker receives share_target POSTs before the app is open.
 * It persists raw payloads here; the app ingests them on next open.
 * Kept in its own DB so the SW never depends on app schema versions.
 */
export interface PendingShare {
  id?: number
  kind: 'text' | 'file'
  text?: string
  title?: string
  url?: string
  fileName?: string
  mimeType?: string
  blob?: Blob
  receivedAt: number
}

export class ShareInboxDB extends Dexie {
  pending!: Table<PendingShare, number>

  constructor() {
    // Schema deliberately minimal: the service worker creates this store with
    // plain IndexedDB (keyPath 'id', autoIncrement) when handling share_target
    // POSTs before the app is open — both definitions must stay compatible.
    super('recall-share-inbox')
    this.version(1).stores({ pending: '++id' })
  }
}

export const shareInbox = new ShareInboxDB()

export async function ingestPendingShares(): Promise<number> {
  const { createFragment } = await import('./capture')
  const items = (await shareInbox.pending.toArray()).sort((a, b) => a.receivedAt - b.receivedAt)
  if (!items.length) return 0
  for (const item of items) {
    try {
      if (item.kind === 'file' && item.blob) {
        await createFragment({
          blob: item.blob,
          fileName: item.fileName,
          mimeType: item.mimeType,
          origin: 'share-target',
        })
      } else {
        const text = [item.title, item.text, item.url].filter(Boolean).join('\n').trim()
        if (text) {
          await createFragment({ text, origin: 'share-target' })
        }
      }
    } catch (e) {
      console.error('[recall] failed to ingest shared item', e)
    }
  }
  await shareInbox.pending.clear()
  return items.length
}
