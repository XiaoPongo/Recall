'use client'

/**
 * Recall — app shell.
 * Single-page, client-side; all state is local (IndexedDB + zustand).
 * Mobile-first: bottom nav + lens chips. Desktop (lg+): sidebar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Loader2, Search, SearchX, Sparkles } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { db, getSettings, ingestPendingShares, shareInbox } from '@/lib/db'
import type { AppSettings } from '@/lib/types'
import { useUI } from '@/lib/store'
import { searchFragments } from '@/lib/search/search'
import { startQueue } from '@/lib/pipeline/queue'
import { registerSW } from '@/lib/sw-register'
import { fragmentsToNotify } from '@/lib/resurface'
import { show } from '@/lib/notify'
import { extractSnippet } from '@/lib/search/search'
import { AppHeader } from './AppHeader'
import { SearchBar } from './SearchBar'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { InboxView } from './InboxView'
import { TodayView } from './TodayView'
import { ThreadsView } from './ThreadsView'
import { FragmentDetail } from './FragmentDetail'
import { FragmentCard } from './FragmentCard'
import { SettingsView } from './SettingsView'
import { SetupWizard } from './SetupWizard'
import { VoiceRecorder } from './VoiceRecorder'
import { EmptyState } from './bits'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

export function MemoryApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const bootedRef = useRef(false)
  const { toast } = useToast()

  const fragments = useLiveQuery(() => db.fragments.orderBy('createdAt').reverse().toArray(), [], undefined)
  const threads = useLiveQuery(() => db.threads.toArray(), [], undefined)
  const jobs = useLiveQuery(() => db.jobs.toArray(), [], undefined)

  const ui = useUI()

  /* boot: settings → SW → queue → share ingestion */
  useEffect(() => {
    void getSettings().then((s) => setSettings(s))
    registerSW()
    // make sure the share-target inbox store exists as early as possible,
    // even before setup is completed — the SW writes into it
    void shareInbox.open().catch(() => {})
    const onInstall = (e: Event) => {
      e.preventDefault()
      setInstallEvt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onInstall)
    return () => window.removeEventListener('beforeinstallprompt', onInstall)
  }, [])

  useEffect(() => {
    if (!settings?.setupComplete || bootedRef.current) return
    bootedRef.current = true
    startQueue()
    void ingestPendingShares().then((n) => {
      if (n > 0) {
        toast({ description: `Ingested ${n} item${n === 1 ? '' : 's'} from the share sheet` })
      }
    })
    const q = new URLSearchParams(window.location.search)
    if (q.has('capture')) {
      setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Quick capture"]')?.focus(), 400)
    }
  }, [settings?.setupComplete, toast])

  const refreshSettings = useCallback(async () => {
    setSettings(await getSettings())
  }, [])

  /* refresh settings whenever jobs finish (pack status etc. can change elsewhere too) */
  useEffect(() => {
    if (!settings?.setupComplete) return
    const id = window.setInterval(() => void refreshSettings(), 2500)
    return () => window.clearInterval(id)
  }, [settings?.setupComplete, refreshSettings])

  /* sparse deadline notifications while the app is open */
  useEffect(() => {
    if (!settings?.setupComplete || !settings.notificationsEnabled) return
    const tick = async () => {
      if (Notification.permission !== 'granted') return
      const frags = await db.fragments.toArray()
      const toNotify = fragmentsToNotify(frags)
      if (!toNotify.length) return
      const f = toNotify[0]
      await show('Possible deadline soon', extractSnippet(f, 120), { fragmentId: f.id })
      f.notifiedAt = Date.now()
      await db.fragments.put(f)
    }
    const first = window.setTimeout(() => void tick(), 20_000)
    const id = window.setInterval(() => void tick(), 5 * 60_000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
    }
  }, [settings?.setupComplete, settings?.notificationsEnabled])

  /* search execution (debounced) */
  useEffect(() => {
    if (!settings) return
    const q = ui.query.trim()
    if (!q) {
      ui.setSearch(null)
      ui.setSearching(false)
      return
    }
    ui.setSearching(true)
    const t = window.setTimeout(async () => {
      const res = await searchFragments(q, fragments ?? [], threads ?? [], {
        lens: 'all',
        semanticReady: settings.packs.semantic === 'ready',
        boundaryRules: settings.boundaryRules,
      })
      ui.setSearch(res.hits, res.timeWindow?.label ?? (res.anchored ? 'matched saves' : undefined))
      ui.setSearching(false)
    }, 240)
    return () => {
      window.clearTimeout(t)
    }
  }, [ui.query, fragments, settings])

  const processingCount = useMemo(() => jobs?.filter((j) => j.status === 'pending' || j.status === 'running').length ?? 0, [jobs])

  if (!settings || fragments === undefined || threads === undefined) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    )
  }

  if (!settings.setupComplete) {
    return <SetupWizard onComplete={refreshSettings} />
  }

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar fragments={fragments} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          installable={!!installEvt}
          onInstall={async () => {
            if (!installEvt) return
            await installEvt.prompt()
            setInstallEvt(null)
          }}
        />
        <SearchBar semanticReady={settings.packs.semantic === 'ready'} />

        <main className="mx-auto w-full max-w-3xl flex-1 px-3 pb-36 pt-4 sm:px-5 lg:pb-12" id="main">
          {ui.view === 'inbox' && <InboxView fragments={fragments} threads={threads} settings={settings} />}
          {ui.view === 'today' && <TodayView fragments={fragments} />}
          {ui.view === 'threads' && <ThreadsView fragments={fragments} threads={threads} />}
          {ui.view === 'search' && (ui.query.trim() ? <SearchResultsView /> : <SearchIdleView />)}
        </main>

        {/* mobile bottom nav */}
        <BottomNav processingCount={processingCount} />
      </div>

      <FragmentDetail fragments={fragments} threads={threads} />
      <VoiceRecorder voicePackReady={settings.packs.voice === 'ready'} />
      {ui.settingsOpen && (
        <SettingsView
          settings={settings}
          onDone={() => {
            ui.setSettingsOpen(false)
            void refreshSettings()
          }}
        />
      )}
    </div>
  )
}

/** friendly landing when the Search tab is opened with an empty query */
function SearchIdleView() {
  const setQuery = useUI((s) => s.setQuery)

  const EXAMPLES = [
    'that laptop fixing article',
    'when I saved the Tokyo stuff',
    'deadlines this week',
    'the recipe with lentils',
    'voice notes about the move',
  ]

  return (
    <div className="space-y-4">
      <EmptyState
        icon={<Search className="h-10 w-10" />}
        title="What are you looking for?"
        body="Describe it loosely — by meaning, by keywords, or by when you saved it. Search combines all three, so exact wording doesn't matter."
      />
      <div className="space-y-2 rounded-3xl border bg-card p-4 shadow-sm">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> Try something like
        </p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
            >
              {ex}
            </button>
          ))}
        </div>
        <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
          Tip: press <kbd className="rounded border bg-muted px-1 font-sans text-[10px]">/</kbd> anywhere to jump into
          search. Time phrases like “last week” become filters automatically.
        </p>
      </div>
    </div>
  )
}

function SearchResultsView() {
  const { searchHits, query, searching, openThread } = useUI()

  if (searching && !searchHits) {
    return (
      <div className="space-y-2.5">
        <Skeleton className="h-24 w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
      </div>
    )
  }
  if (!searchHits || searchHits.length === 0) {
    return (
      <EmptyState
        icon={<SearchX className="h-10 w-10" />}
        title="No matches — yet"
        body={`Nothing matches “${query}”. Try fewer words, or check the time filter — hybrid search combines meaning and keywords, so spelling doesn't need to be exact.`}
      />
    )
  }
  void openThread
  return (
    <div className="space-y-2.5">
      <p className="px-1 text-[11px] text-muted-foreground">
        {searchHits.length} match{searchHits.length === 1 ? '' : 'es'} · ranked by meaning + keywords + time
      </p>
      {searchHits.map((hit) => (
        <FragmentCard key={hit.fragment.id} fragment={hit.fragment} reasons={hit.reasons} />
      ))}
    </div>
  )
}
