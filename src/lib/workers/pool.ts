/**
 * Worker pool client (main thread side of the V3 fix).
 *
 * - 2–4 module workers, created lazily, reused for every background op
 * - the first `heavyCap` workers are "pinned": they host the model
 *   singletons (transformers / tesseract / pdf.js), so heavy jobs reuse
 *   loaded models instead of re-instantiating them per worker
 * - light jobs prefer NON-pinned workers so a pinned slot is almost
 *   always free for the next heavy job
 * - crashes reject their in-flight ops (the queue retries them) and the
 *   slot is respawned with a budget
 * - pack download progress is bridged back to the UI via onPackProgress
 */

import { lexicalVector } from '../ml/lexical'
import type {
  EmbedQueryResult,
  PackProgressMsg,
  WorkerOpName,
  WorkerReply,
  WorkerRequest,
} from './protocol'

export type Affinity = 'pinned' | 'any' | 'prefer-pinned'

export interface ExecOptions {
  /** default 'any' */
  affinity?: Affinity
  /** transferables for the postMessage into the worker */
  transfer?: Transferable[]
}

interface PendingOp {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

class PooledWorker {
  readonly worker: Worker
  readonly slot: number
  inflight = new Map<number, PendingOp>()

  constructor(worker: Worker, slot: number) {
    this.worker = worker
    this.slot = slot
  }

  get busy(): boolean {
    return this.inflight.size > 0
  }
}

class WorkerPool {
  /** total workers in the pool */
  readonly size: number
  /** how many heavy jobs may run concurrently (pinned slots) */
  readonly heavyCap: number
  onPackProgress: ((p: PackProgressMsg) => void) | null = null

  private workers: PooledWorker[] = []
  private parked: Array<{ affinity: Affinity; resolve: (w: PooledWorker) => void }> = []
  private respawns = new Map<number, number>()
  private nextId = 1
  private ensurePromise: Promise<void> | null = null

  constructor() {
    const hc =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4
    this.size = Math.min(4, Math.max(2, hc - 1))
    this.heavyCap = this.size >= 3 ? 2 : 1
  }

  get initialized(): boolean {
    return this.workers.length > 0
  }

  stats(): { size: number; heavyCap: number; alive: number; free: number } {
    return {
      size: this.size,
      heavyCap: this.heavyCap,
      alive: this.workers.length,
      free: this.workers.filter((w) => !w.busy).length,
    }
  }

  async ensure(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = (async () => {
        // best-effort: push the worker script through the SW cache in
        // production so it also loads fully offline
        if (process.env.NODE_ENV === 'production') {
          try {
            await fetch(new URL('./processing.worker.ts', import.meta.url), { cache: 'no-cache' })
          } catch {
            /* offline first load is fine — SW serves what it has */
          }
        }
        for (let slot = 0; slot < this.size; slot++) this.spawn(slot)
      })()
    }
    await this.ensurePromise
  }

  private spawn(slot: number): void {
    try {
      const worker = new Worker(new URL('./processing.worker.ts', import.meta.url), { type: 'module' })
      const pw = new PooledWorker(worker, slot)
      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data
        if (msg?.type === 'pack-progress') {
          this.onPackProgress?.(msg as PackProgressMsg)
          return
        }
        const reply = msg as WorkerReply
        const pending = pw.inflight.get(reply?.id)
        if (!pending) return
        pw.inflight.delete(reply.id)
        if (!pw.inflight.size) this.wake()
        if (reply.ok) pending.resolve(reply.result)
        else pending.reject(new Error(reply.error ?? 'worker error'))
      }
      worker.onerror = () => this.crash(pw)
      worker.onmessageerror = () => this.crash(pw)
      this.workers.push(pw)
      this.wake()
    } catch (e) {
      console.warn('[recall] failed to spawn processing worker', (e as Error)?.message)
    }
  }

  private crash(pw: PooledWorker): void {
    if (!this.workers.includes(pw)) return
    this.workers = this.workers.filter((w) => w !== pw)
    const err = new Error('worker-crashed')
    pw.inflight.forEach((p) => p.reject(err))
    pw.inflight.clear()
    try {
      pw.worker.terminate()
    } catch {
      /* already dead */
    }
    const tries = (this.respawns.get(pw.slot) ?? 0) + 1
    this.respawns.set(pw.slot, tries)
    if (tries <= 3) {
      window.setTimeout(() => this.spawn(pw.slot), 250 * tries)
    }
    this.wake()
  }

  private isPinned(w: PooledWorker): boolean {
    return w.slot < this.heavyCap
  }

  private pick(affinity: Affinity): PooledWorker | null {
    const free = this.workers.filter((w) => !w.busy)
    if (!free.length) return null
    if (affinity === 'pinned') return free.find((w) => this.isPinned(w)) ?? null
    if (affinity === 'prefer-pinned') return free.find((w) => this.isPinned(w)) ?? free[0]
    // 'any' — prefer non-pinned so pinned slots stay available for heavy jobs
    return free.find((w) => !this.isPinned(w)) ?? free[0]
  }

  private acquire(affinity: Affinity): Promise<PooledWorker> {
    const w = this.pick(affinity)
    if (w) return Promise.resolve(w)
    return new Promise<PooledWorker>((resolve) => {
      this.parked.push({ affinity, resolve })
    })
  }

  private wake(): void {
    while (this.parked.length) {
      const idx = this.parked.findIndex((p) => this.pick(p.affinity))
      if (idx === -1) break
      const p = this.parked.splice(idx, 1)[0]
      const w = this.pick(p.affinity)
      if (w) p.resolve(w)
    }
  }

  async exec<T>(op: WorkerOpName, payload: unknown, opts?: ExecOptions): Promise<T> {
    await this.ensure()
    if (!this.workers.length) throw new Error('workers-unavailable')
    const pw = await this.acquire(opts?.affinity ?? 'any')
    const id = this.nextId++
    return await new Promise<T>((resolve, reject) => {
      pw.inflight.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      })
      pw.worker.postMessage({ id, op, payload } as WorkerRequest, opts?.transfer ?? [])
    })
  }
}

/* ------------------------------------------------------------------ */
/* module API                                                           */
/* ------------------------------------------------------------------ */

let poolInstance: WorkerPool | null = null

/** null on the server / in browsers without Worker support */
export function getPool(): WorkerPool | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null
  poolInstance = poolInstance ?? new WorkerPool()
  return poolInstance
}

/**
 * Query embedding fast lane — search never waits behind background jobs.
 * Prefers a pinned worker (already holds the semantic model), otherwise
 * any free worker. Falls back to the sub-millisecond lexical hash on the
 * main thread only when workers are entirely unavailable.
 */
export async function embedQuery(text: string, wantSemantic: boolean): Promise<EmbedQueryResult> {
  const pool = getPool()
  if (pool) {
    try {
      return await pool.exec<EmbedQueryResult>(
        'embed-query',
        { text, semantic: wantSemantic },
        { affinity: 'prefer-pinned' }
      )
    } catch (e) {
      console.warn('[recall] worker query embed failed, using local fallback:', (e as Error)?.message)
    }
  }
  return { lexical: lexicalVector(text), semantic: null }
}
