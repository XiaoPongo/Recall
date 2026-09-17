'use client'

/**
 * Lens chips — the mobile replacement for the type drawer.
 * A gently scrollable chip row; selecting a lens filters the feed.
 */
import { LENSES } from '@/lib/lenses'
import { countByLens } from '@/lib/search/search'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Fragment } from '@/lib/types'

export function LensChips({ fragments }: { fragments: Fragment[] }) {
  const { lens, setLens } = useUI()
  const counts = countByLens(fragments)

  return (
    <div
      className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 scroll-none sm:-mx-5 sm:px-5 lg:hidden"
      role="tablist"
      aria-label="Filter the feed by type"
    >
      {LENSES.map((l) => {
        const active = lens === l.id
        return (
          <button
            key={l.id}
            role="tab"
            aria-selected={active}
            onClick={() => setLens(l.id)}
            className={cn(
              'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
              active
                ? 'border-primary/40 bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                : 'border-border/70 bg-card text-muted-foreground hover:text-foreground'
            )}
          >
            <span className={cn('text-[13px] leading-none', !active && 'opacity-70')}>{l.icon}</span>
            {l.label}
            <span className={cn('text-[10px] font-medium tabular-nums', active ? 'opacity-80' : 'opacity-60')}>
              {counts[l.id] ?? 0}
            </span>
          </button>
        )
      })}
    </div>
  )
}
