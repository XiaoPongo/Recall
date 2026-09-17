'use client'

/**
 * Mobile bottom navigation — thumb-first, safe-area aware.
 * The center of attention: Home (capture + feed). Search focuses the
 * always-visible search bar; Settings opens the settings overlay.
 * The processing strip is tappable and opens the calm queue drawer.
 */
import { CalendarDays, Home, Layers, Loader2, Search, Settings2 } from 'lucide-react'
import { useUI, type MainView } from '@/lib/store'
import { cn } from '@/lib/utils'

export function BottomNav({ lightCount, heavyCount }: { lightCount: number; heavyCount: number }) {
  const { view, setView, setQuery, focusSearch, setSettingsOpen, settingsOpen, setQueueSheetOpen } = useUI()
  const processingCount = lightCount + heavyCount

  const TABS: Array<{
    id: MainView | 'settings'
    label: string
    icon: React.ReactNode
    onTap: () => void
  }> = [
    {
      id: 'inbox',
      label: 'Home',
      icon: <Home className="h-[19px] w-[19px]" />,
      onTap: () => {
        setQuery('')
        setView('inbox')
      },
    },
    {
      id: 'today',
      label: 'Today',
      icon: <CalendarDays className="h-[19px] w-[19px]" />,
      onTap: () => {
        setQuery('')
        setView('today')
      },
    },
    {
      id: 'search',
      label: 'Search',
      icon: <Search className="h-[19px] w-[19px]" />,
      onTap: () => focusSearch(),
    },
    {
      id: 'threads',
      label: 'Threads',
      icon: <Layers className="h-[19px] w-[19px]" />,
      onTap: () => {
        setQuery('')
        setView('threads')
      },
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings2 className="h-[19px] w-[19px]" />,
      onTap: () => setSettingsOpen(true),
    },
  ]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 backdrop-blur-lg lg:hidden"
      aria-label="Primary"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {processingCount > 0 && (
        <button
          onClick={() => setQueueSheetOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 border-b border-border/50 bg-muted/30 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/60"
          aria-label={`Background processing: ${lightCount} quick and ${heavyCount} heavy jobs — tap for details`}
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {lightCount > 0 && <span>{lightCount} quick</span>}
          {lightCount > 0 && heavyCount > 0 && <span aria-hidden="true">·</span>}
          {heavyCount > 0 && <span>{heavyCount} heavy</span>}
          <span className="opacity-70">in background — never blocking you</span>
        </button>
      )}
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((t) => {
          const active = t.id === 'settings' ? settingsOpen : view === t.id
          return (
            <button
              key={t.id}
              onClick={t.onTap}
              className="relative flex min-h-[60px] flex-col items-center justify-center gap-0.5 px-1"
              aria-current={active ? 'page' : undefined}
              aria-label={t.label}
            >
              <span
                className={cn(
                  'flex h-[30px] items-center rounded-full px-4 transition-colors duration-200',
                  active ? 'bg-primary/12 text-primary' : 'text-muted-foreground'
                )}
              >
                {t.icon}
                {t.id === 'inbox' && processingCount > 0 && (
                  <span className="absolute right-3.5 top-2 h-1.5 w-1.5 rounded-full bg-primary/70" aria-hidden="true" />
                )}
              </span>
              <span
                className={cn(
                  'text-[10px] font-semibold leading-none transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {t.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
