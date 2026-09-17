'use client'

/**
 * The calm "background processing" drawer — makes the V3 fix visible.
 * Shows the two lanes (quick text work vs heavy model work), what's
 * running right now, what's waiting, and recent completions — always with
 * the reassurance that capture, search and browsing never wait for these.
 */
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, Feather, Loader2, Weight, Zap } from 'lucide-react'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { db } from '@/lib/db'
import type { Job, JobStep } from '@/lib/types'
import { getQueueStats } from '@/lib/pipeline/queue'
import { useUI } from '@/lib/store'
import { extractSnippet } from '@/lib/search/search'
import { cn } from '@/lib/utils'

const STEP_LABEL: Record<JobStep, string> = {
  dates: 'finding dates',
  urgency: 'reading urgency',
  category: 'guessing category',
  embed: 'indexing words',
  'embed-semantic': 'understanding meaning',
  ocr: 'reading image text',
  transcribe: 'transcribing voice',
  'extract-pdf': 'reading PDF',
  dedupe: 'checking duplicates',
  thread: 'linking memories',
}

function LaneChip({ lane }: { lane: 'light' | 'heavy' }) {
  return lane === 'light' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300">
      <Zap className="h-3 w-3" aria-hidden="true" /> quick
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-400/15 dark:text-violet-300">
      <Weight className="h-3 w-3" aria-hidden="true" /> heavy
    </span>
  )
}

export function QueueSheet() {
  const { queueSheetOpen, setQueueSheetOpen } = useUI()
  const jobs = useLiveQuery(() => db.jobs.toArray(), [], undefined as Job[] | undefined)
  const [now, setNow] = useState(Date.now())

  // tick while open so durations stay live
  useEffect(() => {
    if (!queueSheetOpen) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [queueSheetOpen])

  const stats = useMemo(() => (queueSheetOpen ? getQueueStats() : null), [queueSheetOpen, now, jobs])

  const running = (jobs ?? []).filter((j) => j.status === 'running')
  const waitingLight = (jobs ?? []).filter((j) => j.status === 'pending' && (j.lane ?? 'light') === 'light')
  const waitingHeavy = (jobs ?? []).filter((j) => j.status === 'pending' && j.lane === 'heavy')

  const fragments = useLiveQuery(() => db.fragments.toArray(), [], undefined)
  const snippetById = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of fragments ?? []) m.set(f.id, extractSnippet(f, 56))
    return m
  }, [fragments])

  return (
    <Drawer open={queueSheetOpen} onOpenChange={setQueueSheetOpen}>
      <DrawerContent className="mx-auto max-h-[82dvh] max-w-lg">
        <div className="mx-auto w-full overflow-y-auto px-5 pb-10 pt-2">
          <DrawerHeader className="px-0">
            <DrawerTitle className="font-display text-xl">Working quietly in the background</DrawerTitle>
            <DrawerDescription>
              Everything runs in {stats?.pool?.size ?? 2} background workers — capturing, searching and browsing never
              wait on it. Quick jobs (dates, keywords) always finish before heavy ones (OCR, voice, PDFs).
            </DrawerDescription>
          </DrawerHeader>

          {/* running now */}
          <section className="space-y-2" aria-label="Running now">
            <h3 className="flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              Running now
              {running.length === 0 && <span className="font-normal">— nothing at the moment</span>}
            </h3>
            {running.map((j) => {
              const elapsed = j.startedAt ? Math.max(0, now - j.startedAt) : 0
              return (
                <div
                  key={j.id}
                  className="flex items-center gap-2.5 rounded-2xl border bg-card px-3.5 py-2.5 shadow-sm"
                >
                  <LaneChip lane={(j.lane ?? 'light') as 'light' | 'heavy'} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-tight">{STEP_LABEL[j.type] ?? j.type}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {snippetById.get(j.fragmentId) ?? '…'}
                    </div>
                  </div>
                  <span className={cn('shrink-0 text-[11px] tabular-nums text-muted-foreground')}>
                    {elapsed < 60_000 ? `${Math.round(elapsed / 1000)}s` : `${Math.floor(elapsed / 60_000)}m`}
                  </span>
                </div>
              )
            })}
          </section>

          {/* waiting lanes */}
          <section className="mt-5 grid grid-cols-2 gap-2.5" aria-label="Waiting">
            <div className="rounded-2xl border bg-card/60 p-3.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <Zap className="h-3 w-3" aria-hidden="true" /> quick lane
              </div>
              <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{waitingLight.length}</div>
              <div className="text-[10px] text-muted-foreground">waiting · always first</div>
            </div>
            <div className="rounded-2xl border bg-card/60 p-3.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                <Weight className="h-3 w-3" aria-hidden="true" /> heavy lane
              </div>
              <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{waitingHeavy.length}</div>
              <div className="text-[10px] text-muted-foreground">
                waiting · {stats?.pool?.heavyCap ?? 1} at a time
              </div>
            </div>
          </section>

          {/* recent activity */}
          {stats && stats.recent.length > 0 && (
            <section className="mt-5 space-y-1.5" aria-label="Recently finished">
              <h3 className="px-1 text-xs font-semibold text-muted-foreground">Recently finished</h3>
              {stats.recent.slice(0, 6).map((r, i) => (
                <div
                  key={`${r.step}-${r.at}-${i}`}
                  className="flex items-center gap-2 rounded-2xl bg-muted/40 px-3.5 py-2"
                >
                  {r.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  ) : (
                    <Feather className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  )}
                  <span className="text-[12px]">
                    {STEP_LABEL[r.step] ?? r.step}
                    {!r.ok && <span className="text-muted-foreground"> — kept safe &amp; searchable ({r.error})</span>}
                    {r.ok && r.ms != null && <span className="text-muted-foreground"> · {r.ms}ms</span>}
                  </span>
                </div>
              ))}
            </section>
          )}

          <p className="mt-6 px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
            Fragments are saved and searchable the instant you capture them —
            <br />
            all of this only adds understanding on top.
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
