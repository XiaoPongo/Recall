'use client'

/**
 * Memory threads — auto-grouped topics. This is derived structure,
 * not user organization; it updates as new fragments arrive.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Fragment, Thread } from '@/lib/types'
import { relTime } from '@/lib/format'
import { useUI } from '@/lib/store'
import { EmptyState } from './bits'
import { FragmentCard } from './FragmentCard'
import { cn } from '@/lib/utils'

export function ThreadsView({ fragments, threads }: { fragments: Fragment[]; threads: Thread[] }) {
  const selectedThreadId = useUI((s) => s.selectedThreadId)
  const openThread = useUI((s) => s.openThread)

  const byThread = useMemo(() => {
    const map = new Map<string, Fragment[]>()
    for (const f of fragments) {
      if (!f.threadId) continue
      const list = map.get(f.threadId) ?? []
      list.push(f)
      map.set(f.threadId, list)
    }
    return map
  }, [fragments])

  const sorted = useMemo(
    () => threads.filter((t) => (byThread.get(t.id)?.length ?? 0) > 0).sort((a, b) => b.updatedAt - a.updatedAt),
    [threads, byThread]
  )

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!sorted.length) {
    return (
      <EmptyState
        icon={<Layers className="h-10 w-10" />}
        title="No threads yet"
        body="When related fragments are saved close in time or share a topic, they group into a thread automatically — no folders, no tags."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Threads</h2>
        <span className="text-xs text-muted-foreground">grouped automatically</span>
      </div>

      {sorted.map((t) => {
        const members = (byThread.get(t.id) ?? []).sort((a, b) => b.createdAt - a.createdAt)
        const open = expanded.has(t.id) || selectedThreadId === t.id
        return (
          <section
            key={t.id}
            className="overflow-hidden rounded-2xl border bg-card shadow-sm"
            aria-label={t.title}
          >
            <button className="flex w-full items-start gap-3 p-4 text-left" onClick={() => toggle(t.id)}>
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Layers className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                    {members.length} fragment{members.length === 1 ? '' : 's'}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">updated {relTime(t.updatedAt)}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.summary}</p>
              </div>
              <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
              <div className="space-y-2.5 border-t bg-muted/20 p-3">
                {members.map((f) => (
                  <FragmentCard key={f.id} fragment={f} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
