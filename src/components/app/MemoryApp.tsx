'use client'

/**
 * Recall — app shell.
 * Single-page, client-side; all state is local (IndexedDB + zustand).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Inbox, Layers, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { TypeDrawer } from './TypeDrawer'
import { InboxView } from './InboxView'
import { TodayView } from './TodayView'
import { ThreadsView } from './ThreadsView'
import { FragmentDetail } from './FragmentDetail'
import { FragmentCard } from './FragmentCard'
import { SettingsView } from './SettingsView'
import { SetupWizard } from './SetupWizard'
import { VoiceRecorder } from './VoiceRecorder'
import { EmptyState } from './bits'
import { cn } from '@/lib/utils'

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
      if (ui.view === 'search') ui.setView('inbox')
      ui.setSearch(null)
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
      <TypeDrawer fragments={fragments} />

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

        <main className="mx-auto w-full max-w-3xl flex-1 px-3 pb-28 pt-4 sm:px-5 lg:pb-10" id="main">
          {ui.view === 'inbox' && <InboxView fragments={fragments} threads={threads} settings={settings} />}
          {ui.view === 'today' && <TodayView fragments={fragments} />}
          {ui.view === 'threads' && <ThreadsView fragments={fragments} threads={threads} />}
          {ui.view === 'search' && <SearchResultsView />}
        </main>

        {/* mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-md lg:hidden" aria-label="Primary">
          <div className="mx-auto grid max-w-md grid-cols-3">
            {(
              [
                ['inbox', 'Inbox', <Inbox className="h-5 w-5" key="i" />],
                ['today', 'Today', <CalendarDays className="h-5 w-5" key="t" />],
                ['threads', 'Threads', <Layers className="h-5 w-5" key="th" />],
              ] as Array<[typeof ui.view, string, React.ReactNode]>
            ).map(([id, label, icon]) => (
              <button
                key={id}
                onClick={() => {
                  ui.setQuery('')
                  ui.setView(id)
                }}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors',
                  ui.view === id ? 'text-primary' : 'text-muted-foreground'
                )}
                aria-current={ui.view === id ? 'page' : undefined}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          {processingCount > 0 && (
            <div className="flex items-center justify-center gap-1.5 border-t bg-muted/40 py-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> processing {processingCount} fragment{processingCount === 1 ? '' : 's'} on-device
            </div>
          )}
        </nav>
      </div>

      <FragmentDetail fragments={fragments} threads={threads} />
      <VoiceRecorder voicePackReady={settings.packs.voice === 'ready'} />
      {ui.settingsOpen && <SettingsView settings={settings} onDone={() => { ui.setSettingsOpen(false); void refreshSettings() }} />}
    </div>
  )
}

function SearchResultsView() {
  const { searchHits, query, searching, openThread } = useUI()

  if (searching && !searchHits) {
    return (
      <div className="space-y-2.5">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    )
  }
  if (!searchHits || searchHits.length === 0) {
    return (
      <EmptyState
        icon={<Search className="h-10 w-10" />}
        title="No matches"
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
