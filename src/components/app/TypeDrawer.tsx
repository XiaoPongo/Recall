'use client'

/**
 * Inbox drawer — lenses onto ONE memory pool. Views, not folders:
 * nobody files anything; the lenses are computed automatically.
 */
import { AudioLines, CalendarClock, FileText, Image as ImageIcon, Inbox, Layers, Link2, ListTodo, StickyNote, Users } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useUI, type Lens } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Fragment } from '@/lib/types'
import { countByLens } from '@/lib/search/search'

const LENSES: Array<{ id: Lens; label: string; icon: React.ReactNode }> = [
  { id: 'all', label: 'Everything', icon: <Inbox className="h-4 w-4" /> },
  { id: 'deadlines', label: 'Deadlines', icon: <CalendarClock className="h-4 w-4" /> },
  { id: 'meetings', label: 'Meetings', icon: <Users className="h-4 w-4" /> },
  { id: 'link', label: 'Links', icon: <Link2 className="h-4 w-4" /> },
  { id: 'pdf', label: 'PDFs', icon: <FileText className="h-4 w-4" /> },
  { id: 'image', label: 'Screenshots', icon: <ImageIcon className="h-4 w-4" /> },
  { id: 'audio', label: 'Voice notes', icon: <AudioLines className="h-4 w-4" /> },
  { id: 'text', label: 'Text notes', icon: <StickyNote className="h-4 w-4" /> },
  { id: 'unprocessed', label: 'Processing', icon: <ListTodo className="h-4 w-4" /> },
]

export function TypeDrawerContent({ fragments, onNavigate }: { fragments: Fragment[]; onNavigate?: () => void }) {
  const { lens, setLens, setView } = useUI()
  const counts = countByLens(fragments)

  function pick(l: Lens) {
    setLens(l)
    setView('inbox')
    onNavigate?.()
  }

  return (
    <nav className="flex h-full flex-col gap-0.5 p-2" aria-label="Browse by type">
      <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Memory pool
      </div>
      {LENSES.map((l) => (
        <button
          key={l.id}
          onClick={() => pick(l.id)}
          className={cn(
            'flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
            lens === l.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
          aria-current={lens === l.id ? 'page' : undefined}
        >
          <span className={cn(lens === l.id ? 'text-primary' : '')}>{l.icon}</span>
          <span className="flex-1 text-left">{l.label}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{counts[l.id] ?? 0}</span>
        </button>
      ))}
      <div className="mt-3 px-2 text-[11px] leading-relaxed text-muted-foreground/80">
        These are lenses, not folders — everything lives in a single pool and is grouped automatically.
      </div>
    </nav>
  )
}

export function TypeDrawer({ fragments }: { fragments: Fragment[] }) {
  const { drawerOpen, setDrawerOpen, setView } = useUI()
  return (
    <>
      {/* desktop persistent sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r bg-sidebar/60 lg:block">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Browse</span>
        </div>
        <div className="h-[calc(100dvh-3.5rem)] overflow-y-auto scroll-slim">
          <TypeDrawerContent fragments={fragments} />
        </div>
      </aside>

      {/* mobile sheet */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-left">
              <Layers className="h-4 w-4 text-primary" /> Browse memory
            </SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100dvh-4.5rem)] overflow-y-auto scroll-slim">
            <TypeDrawerContent fragments={fragments} onNavigate={() => setDrawerOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
