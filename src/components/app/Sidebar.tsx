'use client'

/**
 * Desktop navigation sidebar — wide viewports only (lg+).
 * Mobile uses the bottom nav + lens chips instead.
 */
import { CalendarDays, Home, Layers, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LENSES } from '@/lib/lenses'
import { countByLens } from '@/lib/search/search'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Fragment } from '@/lib/types'
import { LocalBadge, RippleMark } from './bits'

export function Sidebar({ fragments }: { fragments: Fragment[] }) {
  const { view, setView, lens, setLens, setQuery, setSettingsOpen } = useUI()
  const counts = countByLens(fragments)

  const NAV: Array<{ id: 'inbox' | 'today' | 'threads'; label: string; icon: React.ReactNode }> = [
    { id: 'inbox', label: 'Home', icon: <Home className="h-4.5 w-4.5" /> },
    { id: 'today', label: 'Today', icon: <CalendarDays className="h-4.5 w-4.5" /> },
    { id: 'threads', label: 'Threads', icon: <Layers className="h-4.5 w-4.5" /> },
  ]

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar/70 lg:flex" aria-label="Primary">
      {/* brand */}
      <div className="flex items-center gap-3 px-5 pb-5 pt-5">
        <RippleMark className="h-9 w-9 rounded-xl shadow-md shadow-primary/25" />
        <div className="leading-tight">
          <div className="font-display text-lg font-semibold tracking-tight">Recall</div>
          <div className="text-[11px] text-muted-foreground">your private memory</div>
        </div>
      </div>

      <nav className="space-y-1 px-3" aria-label="Views">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => {
              setQuery('')
              setView(n.id)
            }}
            className={cn(
              'flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
              view === n.id
                ? 'bg-primary/12 text-primary'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
            aria-current={view === n.id ? 'page' : undefined}
          >
            {n.icon}
            {n.label}
          </button>
        ))}
      </nav>

      {/* lenses */}
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto scroll-slim px-3 pb-2">
        <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Memory pool
        </div>
        <nav className="space-y-0.5" aria-label="Browse by type">
          {LENSES.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setQuery('')
                setLens(l.id)
              }}
              className={cn(
                'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                lens === l.id && view === 'inbox'
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
              aria-current={lens === l.id && view === 'inbox' ? 'page' : undefined}
            >
              <span className={cn(lens === l.id && view === 'inbox' ? 'text-primary' : 'opacity-70')}>
                {l.icon}
              </span>
              <span className="flex-1 text-left">{l.label}</span>
              <span className="text-[11px] tabular-nums text-muted-foreground/80">{counts[l.id] ?? 0}</span>
            </button>
          ))}
        </nav>
        <p className="px-3 pt-3 text-[11px] leading-relaxed text-muted-foreground/70">
          Lenses, not folders — everything lives in one pool and is grouped automatically.
        </p>
      </div>

      {/* footer */}
      <div className="space-y-3 border-t p-4">
        <Button
          variant="outline"
          className="w-full justify-start gap-3"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="h-4 w-4" /> Settings
        </Button>
        <LocalBadge />
      </div>
    </aside>
  )
}
