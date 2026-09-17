'use client'

/**
 * Universal search — the primary interface.
 * Natural-language friendly; type/time filters as chips.
 */
import { useEffect, useRef } from 'react'
import { Loader2, Search, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

const TIME_PRESETS = [
  { label: 'Any time', q: '' },
  { label: 'Today', q: 'today' },
  { label: 'This week', q: 'this week' },
  { label: 'Last week', q: 'last week' },
  { label: 'This month', q: 'this month' },
] as const

export function SearchBar({ semanticReady }: { semanticReady: boolean }) {
  const { query, setQuery, view, searchTimeLabel, searching, searchFocusToken } = useUI()
  const inputRef = useRef<HTMLInputElement>(null)

  // focus search on "/" keyboard shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // the bottom-nav Search tab asks us to grab focus
  useEffect(() => {
    if (searchFocusToken > 0) inputRef.current?.focus()
  }, [searchFocusToken])

  function appendTime(preset: string) {
    // toggle a time suffix onto the query
    const base = query.replace(/\b(today|this week|last week|this month)\b/gi, '').replace(/\s+/g, ' ').trim()
    if (!preset) {
      setQuery(base)
      return
    }
    setQuery(base ? `${base} ${preset}` : preset)
  }

  const activePreset = TIME_PRESETS.find((p) => p.q && query.toLowerCase().includes(p.q))

  return (
    <div className="sticky top-14 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto w-full max-w-6xl px-3 py-2.5 sm:px-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.trim() && setQuery(query)}
            placeholder="Ask your memory — “that laptop article”, “Tokyo stuff”, “due next week”…"
            className="h-12 rounded-full border-border/70 bg-card pl-11 pr-11 text-sm shadow-sm transition-shadow focus-visible:ring-primary/30"
            aria-label="Search all saved fragments"
          />
          <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {searching && view === 'search' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {query && (
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setQuery('')} aria-label="Clear search">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5 scroll-none">
          {TIME_PRESETS.map((p) => {
            const active = (p.q === '' && !activePreset) || (activePreset && activePreset.q === p.q)
            return (
              <button
                key={p.label}
                onClick={() => appendTime(p.q)}
                className={cn(
                  'min-h-8 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition-colors',
                  active
                    ? 'border-primary/40 bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                    : 'border-transparent bg-muted/60 text-muted-foreground hover:bg-muted'
                )}
              >
                {p.label}
              </button>
            )
          })}
          {searchTimeLabel && (
            <span className="shrink-0 rounded-full border border-primary/30 bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-foreground">
              around: {searchTimeLabel}
            </span>
          )}
          {!semanticReady && query.trim() && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title="Download the Semantic pack in Settings for meaning-based search">
              <Sparkles className="h-3 w-3" /> basic keyword mode
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
