'use client'

/**
 * Today / This Week — auto-generated agenda from detected dates.
 * No search needed; what's time-sensitive comes to you.
 */
import { useMemo } from 'react'
import { CalendarDays, CalendarX } from 'lucide-react'
import type { Fragment } from '@/lib/types'
import { dateTimeLabel, dayLabel } from '@/lib/format'
import { nearestAnyDateMs } from '@/lib/pipeline/dates'
import { useUI } from '@/lib/store'
import { EmptyState, TypeIcon, UrgencyDot } from './bits'
import { format } from 'date-fns'

interface AgendaEntry {
  fragment: Fragment
  time: number
}

export function TodayView({ fragments }: { fragments: Fragment[] }) {
  const openFragment = useUI((s) => s.openFragment)
  const now = Date.now()

  const entries = useMemo(() => {
    const out: AgendaEntry[] = []
    for (const f of fragments) {
      const nearest = nearestAnyDateMs(f.extracted.dates ?? [])
      if (nearest !== null) out.push({ fragment: f, time: nearest })
    }
    return out.sort((a, b) => a.time - b.time)
  }, [fragments])

  const groups = useMemo(() => {
    const endOfToday = new Date()
    endOfToday.setHours(23, 59, 59, 999)
    const endOfTomorrow = new Date(endOfToday.getTime() + 86_400_000)
    const endOfWeek = new Date(endOfToday.getTime() + 7 * 86_400_000)
    return {
      overdue: entries.filter((e) => e.time < now - 3_600_000),
      today: entries.filter((e) => e.time >= now - 3_600_000 && e.time <= endOfToday.getTime()),
      tomorrow: entries.filter((e) => e.time > endOfToday.getTime() && e.time <= endOfTomorrow.getTime()),
      thisWeek: entries.filter((e) => e.time > endOfTomorrow.getTime() && e.time <= endOfWeek.getTime()),
      later: entries.filter((e) => e.time > endOfWeek.getTime()).slice(0, 8),
    }
  }, [entries, now])

  const hasAny = entries.length > 0

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 px-1">
        <CalendarDays className="h-4 w-4 text-primary" />
        <h2 className="font-display text-lg font-semibold tracking-tight">Today &amp; this week</h2>
        <span className="text-xs text-muted-foreground">detected from your saves</span>
      </div>

      {!hasAny && (
        <EmptyState
          icon={<CalendarX className="h-10 w-10" />}
          title="No dates detected yet"
          body="When something you save mentions a date — “Friday 5pm”, “due next week” — it lands here automatically, with a confidence level."
        />
      )}

      {(
        [
          ['Overdue', groups.overdue],
          ['Today', groups.today],
          ['Tomorrow', groups.tomorrow],
          ['Rest of this week', groups.thisWeek],
          ['Later', groups.later],
        ] as Array<[string, AgendaEntry[]]>
      ).map(([label, items]) =>
        items.length ? (
          <section key={label} aria-label={label}>
            <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
            <div className="space-y-2">
              {items.map(({ fragment: f, time }) => (
                <button
                  key={f.id}
                  onClick={() => openFragment(f.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/30"
                >
                  <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-primary/10 py-1.5">
                    <span className="text-[10px] font-medium uppercase text-muted-foreground">
                      {format(new Date(time), 'MMM')}
                    </span>
                    <span className="text-lg font-semibold leading-none">{format(new Date(time), 'd')}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <TypeIcon type={f.type} />
                      <span className="truncate">{firstLine(f)}</span>
                      <UrgencyDot level={f.extracted.urgency.level} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{dateTimeLabel(time)}</span>
                      {f.extracted.category && (
                        <span className="rounded-full bg-muted px-1.5 py-px">
                          likely {f.extracted.category.label} · {f.extracted.category.confidence} conf.
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null
      )}
      {groups.overdue.length > 0 && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Overdue items are kept for reference — their dates were detected locally and may be approximate.
        </p>
      )}
    </div>
  )
}

function firstLine(f: Fragment): string {
  const t = (f.textContent || f.rawContent || '').split('\n')[0]
  return t.length > 70 ? t.slice(0, 70) + '…' : t
}
