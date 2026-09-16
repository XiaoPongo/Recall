'use client'

/**
 * Inbox — the universal feed. Capture at top, resurfaced items above it,
 * fragments grouped by day. Lens-filtered via the drawer.
 */
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlarmClock, BellRing, CheckCheck, EyeOff, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AppSettings, Fragment, ResurfaceItem, Thread } from '@/lib/types'
import { db, updateSettings } from '@/lib/db'
import { computeDigest, computeResurfaceItems } from '@/lib/resurface'
import { dayLabel } from '@/lib/format'
import { useUI } from '@/lib/store'
import { seedSampleData } from '@/lib/seed'
import { useToast } from '@/hooks/use-toast'
import { browseFragments } from '@/lib/search/search'
import { EmptyState } from './bits'
import { QuickCapture } from './QuickCapture'
import { FragmentCard } from './FragmentCard'
import { cn } from '@/lib/utils'

export function ResurfaceStack({ items, onDigestCount }: { items: ResurfaceItem[]; onDigestCount?: (n: number) => void }) {
  void onDigestCount
  if (!items.length) return null
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <ResurfaceCard key={item.fragment.id} item={item} />
      ))}
    </div>
  )
}

function ResurfaceCard({ item }: { item: ResurfaceItem }) {
  const [hidden, setHidden] = useState(false)
  const f = item.fragment
  const { toast } = useToast()
  const openFragment = useUI((s) => s.openFragment)

  async function act(kind: 'yes' | 'no' | 'forget' | 'snooze') {
    setHidden(true)
    const frag = await db.fragments.get(f.id)
    if (!frag) return
    if (kind === 'yes') {
      frag.lastSurfacedAt = Date.now()
      await db.fragments.put(frag)
      openFragment(f.id)
    } else if (kind === 'no') {
      frag.dismissedAt = Date.now()
      await db.fragments.put(frag)
      toast({ description: "Okay — this won't be resurfaced again" })
    } else if (kind === 'snooze') {
      frag.snoozedUntil = Date.now() + 7 * 86_400_000
      await db.fragments.put(frag)
      toast({ description: 'Snoozed for a week' })
    } else {
      const { forgetTopic } = await import('@/lib/capture')
      await forgetTopic(f.id)
      toast({ description: 'Topic suppressed from resurfacing — data kept, still searchable' })
    }
  }

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-accent/70 to-card p-3.5 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              {item.reason === 'deadline-soon' ? <AlarmClock className="h-4 w-4" /> : item.reason === 'on-this-day' ? <Sparkles className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <button className="block w-full text-left" onClick={() => openFragment(f.id)}>
                <div className="text-[13px] font-medium leading-relaxed">{item.note}</div>
                <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                  {f.textContent || f.rawContent}
                </p>
              </button>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Button size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => act('yes')}>
                  <CheckCheck className="mr-1 h-3.5 w-3.5" /> Still relevant
                </Button>
                <Button size="sm" variant="outline" className="h-7 rounded-full px-3 text-xs" onClick={() => act('no')}>
                  Not anymore
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full px-3 text-xs text-muted-foreground"
                  onClick={() => act('forget')}
                  title="Stop resurfacing this topic — the data stays"
                >
                  <EyeOff className="mr-1 h-3.5 w-3.5" /> Forget this topic
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full px-2.5 text-xs text-muted-foreground"
                  onClick={() => act('snooze')}
                  title="Hide for a week"
                >
                  snooze
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function DigestCard({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <AlarmClock className="h-4 w-4" />
      </div>
      <p className="flex-1 text-sm">
        <span className="font-medium">{count} {count === 1 ? 'thing' : 'things'} you saved this week</span>{' '}
        <span className="text-muted-foreground">look time-sensitive.</span>
      </p>
      <Button size="sm" variant="outline" className="h-8" onClick={() => useUI.getState().setLens('deadlines')}>
        Review
      </Button>
      <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={onDismiss}>
        Dismiss
      </Button>
    </motion.div>
  )
}

export function InboxView({
  fragments,
  threads,
  settings,
}: {
  fragments: Fragment[]
  threads: Thread[]
  settings: AppSettings
}) {
  const lens = useUI((s) => s.lens)
  const [seeding, setSeeding] = useState(false)
  const { toast } = useToast()

  const visible = useMemo(() => browseFragments(fragments, lens), [fragments, lens])
  const resurface = useMemo(() => computeResurfaceItems(fragments, threads, settings), [fragments, threads, settings])
  const digest = useMemo(() => computeDigest(fragments, settings), [fragments, settings])
  const threadById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads])

  const grouped = useMemo(() => {
    const groups: Array<{ day: string; items: Fragment[] }> = []
    for (const f of visible) {
      const day = dayLabel(f.createdAt)
      const last = groups[groups.length - 1]
      if (last && last.day === day) last.items.push(f)
      else groups.push({ day, items: [f] })
    }
    return groups
  }, [visible])

  async function seed() {
    setSeeding(true)
    try {
      const n = await seedSampleData()
      toast({ description: n ? `Added ${n} sample fragments` : 'Memory pool not empty' })
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="space-y-4">
      <QuickCapture />

      {(resurface.length > 0 || digest.due) && (
        <section aria-label="Resurfaced" className="space-y-2">
          {digest.due && (
            <DigestCard
              count={digest.count}
              onDismiss={() => void updateSettings({ lastDigestAt: Date.now() })}
            />
          )}
          <ResurfaceStack items={resurface} />
        </section>
      )}

      {fragments.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-10 w-10" />}
          title="Your memory pool is empty"
          body="Save anything — text, links, screenshots, PDFs, voice notes. No folders, no tags. Find it later by describing it."
          action={
            <Button variant="outline" size="sm" onClick={seed} disabled={seeding}>
              {seeding ? 'Adding…' : 'Add sample data'}
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing in this lens" body="Fragments appear here automatically as you capture them. Nothing to file, ever." />
      ) : (
        grouped.map((g) => (
          <section key={g.day} aria-label={g.day}>
            <h2 className={cn('mb-2 mt-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground')}>
              {g.day}
            </h2>
            <div className="space-y-2.5">
              {g.items.map((f) => (
                <FragmentCard key={f.id} fragment={f} thread={f.threadId ? threadById.get(f.threadId) : undefined} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
