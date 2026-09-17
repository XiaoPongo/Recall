'use client'

/**
 * Settings — intelligence packs, privacy boundaries, notifications,
 * storage budget, data export/delete.
 */
import { useEffect, useState } from 'react'
import {
  Brain, CalendarHeart, Download, HardDrive, Info, Monitor, Moon, Package, Palette, RotateCw, ShieldCheck, Smartphone, Sun, Trash2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { db, DEFAULT_SETTINGS, updateSettings } from '@/lib/db'
import type { AppSettings, BoundaryRule, FragmentType, PackId } from '@/lib/types'
import { PACKS, clearPackCaches, downloadPack, subscribePackProgress, type PackProgress } from '@/lib/ml/packs'
import { requeueForPack, rebuildIndex } from '@/lib/pipeline/queue'
import { computeStorageReport, downloadBlob, dropTranscribedAudio, exportAllData } from '@/lib/export'
import { deleteAllData } from '@/lib/capture'
import { fmtBytes } from '@/lib/format'
import { notificationPermission, notificationsSupported, requestNotificationPermission } from '@/lib/notify'
import { useTheme, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'

type Tab = 'appearance' | 'intelligence' | 'privacy' | 'storage' | 'data'

export function SettingsView({ settings, onDone }: { settings: AppSettings; onDone: () => void }) {
  const [tab, setTab] = useState<Tab>('intelligence')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <h2 className="font-display text-lg font-semibold">Settings</h2>
        <span className="rounded-full border border-emerald-600/25 bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          everything stays on this device
        </span>
        <Button variant="ghost" size="icon" className="ml-auto rounded-full" onClick={onDone} aria-label="Close settings">
          <X className="h-5 w-5" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 scroll-none sm:w-48 sm:flex-col sm:border-b-0 sm:border-r sm:p-3">
          {(
            [
              ['appearance', 'Appearance', <Palette className="h-4 w-4" key="a" />],
              ['intelligence', 'Intelligence', <Brain className="h-4 w-4" key="b" />],
              ['privacy', 'Privacy', <ShieldCheck className="h-4 w-4" key="p" />],
              ['storage', 'Storage', <HardDrive className="h-4 w-4" key="s" />],
              ['data', 'Data', <Download className="h-4 w-4" key="d" />],
            ] as Array<[Tab, string, React.ReactNode]>
          ).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                tab === id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {icon} {label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-4 sm:p-6">
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'intelligence' && <IntelligenceTab settings={settings} />}
          {tab === 'privacy' && <PrivacyTab settings={settings} />}
          {tab === 'storage' && <StorageTab />}
          {tab === 'data' && <DataTab />}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function AppearanceTab() {
  const { pref, setPref } = useTheme()

  const OPTIONS: Array<{ id: ThemePref; label: string; icon: React.ReactNode; hint: string }> = [
    { id: 'system', label: 'System', icon: <Monitor className="h-4 w-4" />, hint: 'Follows your device setting' },
    { id: 'light', label: 'Light', icon: <Sun className="h-4 w-4" />, hint: 'Warm ivory' },
    { id: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" />, hint: 'Warm espresso' },
  ]

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <SectionTitle
        title="Appearance"
        body="Recall follows your system theme by default. Pick a preference here to override it — it applies instantly, everywhere."
      />
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-3 gap-2 rounded-2xl border bg-card p-2 shadow-sm"
      >
        {OPTIONS.map((o) => {
          const active = pref === o.id
          return (
            <button
              key={o.id}
              role="radio"
              aria-checked={active}
              onClick={() => setPref(o.id)}
              className={cn(
                'flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border transition-colors',
                active
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {o.icon}
              <span className="text-xs font-semibold">{o.label}</span>
              <span className="text-[10px] opacity-70">{o.hint}</span>
            </button>
          )
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Your choice is stored on this device only. The quick toggle in the top bar cycles through the same options.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function IntelligenceTab({ settings }: { settings: AppSettings }) {
  const [progress, setProgress] = useState<Partial<Record<PackId, PackProgress>>>({})
  const [refresh, setRefresh] = useState(0)
  useEffect(() => subscribePackProgress((p) => setProgress((prev) => ({ ...prev, [p.id]: p }))), [])
  void refresh

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <SectionTitle
        title="Local intelligence"
        body="Models run entirely on this device. Downloads happen once; afterwards they're cached and work offline. You can always add or remove these later."
      />
      {PACKS.map((p) => {
        const status = settings.packs[p.id]
        const pr = progress[p.id]
        const busy = status === 'downloading' || (pr?.status === 'downloading')
        return (
          <div key={p.id} className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <Package className="h-4 w-4 text-primary" /> {p.name}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">~{p.approxMB} MB · {p.requires.join(', ')}</p>
              </div>
              <StatusBadge status={status} />
            </div>
            {busy && (
              <div className="space-y-1">
                <Progress value={pr?.pct ?? (status === 'ready' ? 100 : 0)} className="h-1.5" />
                <p className="truncate text-[11px] text-muted-foreground">{pr?.note ?? 'starting…'}</p>
              </div>
            )}
            {settings.packErrors[p.id] && (
              <p className="text-xs text-destructive">last error: {settings.packErrors[p.id]}</p>
            )}
            <div className="flex gap-2">
              {status === 'not-downloaded' || status === 'error' ? (
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await downloadPack(p.id)
                      await requeueForPack(p.id)
                      setRefresh((r) => r + 1)
                    } catch { /* progress event already surfaced the error */ }
                  }}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download
                </Button>
              ) : null}
              {status === 'ready' && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">ready — cached for offline use</span>
              )}
            </div>
          </div>
        )
      })}
      <div className="rounded-xl border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
        <p><strong className="text-foreground">Basic mode</strong> is always available: keyword search, date detection, urgency scoring, threads and duplicate detection run with zero downloads.</p>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
    downloading: 'border-primary/30 bg-primary/10 text-primary',
    error: 'border-destructive/30 bg-destructive/10 text-destructive',
    'not-downloaded': '',
  }
  const labels: Record<string, string> = {
    ready: 'ready',
    downloading: 'downloading',
    error: 'failed',
    'not-downloaded': 'not installed',
  }
  return <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', map[status])}>{labels[status] ?? status}</span>
}

/* ------------------------------------------------------------------ */

function PrivacyTab({ settings }: { settings: AppSettings }) {
  const { toast } = useToast()
  const [ruleKind, setRuleKind] = useState<'type' | 'source'>('type')
  const [ruleValue, setRuleValue] = useState('')
  const [perm, setPerm] = useState<string>('')
  useEffect(() => {
    void notificationPermission().then((p) => setPerm(p))
  }, [settings.notificationsEnabled])

  const TYPE_OPTIONS: Array<{ v: FragmentType; l: string }> = [
    { v: 'image', l: 'Screenshots & images' },
    { v: 'pdf', l: 'PDFs' },
    { v: 'audio', l: 'Voice notes' },
    { v: 'link', l: 'Links' },
    { v: 'text', l: 'Text notes' },
  ]

  async function addRule() {
    const value = ruleValue.trim()
    if (!value) return
    const rule: BoundaryRule = {
      id: crypto.randomUUID(),
      kind: ruleKind,
      value: ruleKind === 'type' ? value : value.toLowerCase(),
      createdAt: Date.now(),
    }
    await updateSettings({ boundaryRules: [...settings.boundaryRules, rule] })
    setRuleValue('')
    toast({ description: 'Boundary rule added — matching fragments are excluded from all processing and indexing' })
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <SectionTitle title="Privacy" body="Recall has no server. Storage, search, OCR and transcription all run locally — the only network use is downloading the model packs above, once." />

      <div className="flex items-start gap-3 rounded-xl border border-emerald-600/25 bg-emerald-600/5 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="text-sm leading-relaxed">
          <p className="font-medium">Local-only by design</p>
          <p className="text-muted-foreground">
            Fragments, embeddings and extracted data live in this browser's storage on this device. Export gives you everything; delete removes everything.
          </p>
        </div>
      </div>

      {/* memory boundary */}
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <div>
          <p className="font-medium">Memory boundary — never process</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Exclude whole types or sources (domains, app names) from OCR, embeddings and indexing. Boundary items remain saved and visible in the type drawer, but stay out of search.
          </p>
        </div>
        {settings.boundaryRules.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {settings.boundaryRules.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 py-1 pl-2.5 pr-1 text-xs">
                {r.kind === 'type' ? `all ${r.value}s` : `from ${r.value}`}
                <button
                  className="rounded-full p-0.5 hover:bg-muted"
                  aria-label={`Remove rule ${r.value}`}
                  onClick={() => updateSettings({ boundaryRules: settings.boundaryRules.filter((x) => x.id !== r.id) })}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={ruleKind} onValueChange={(v) => setRuleKind(v as 'type' | 'source')}>
            <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="type">Fragment type</SelectItem>
              <SelectItem value="source">Source contains…</SelectItem>
            </SelectContent>
          </Select>
          {ruleKind === 'type' ? (
            <Select value={ruleValue} onValueChange={setRuleValue}>
              <SelectTrigger className="h-9 w-48 text-xs"><SelectValue placeholder="choose type" /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={ruleValue}
              onChange={(e) => setRuleValue(e.target.value)}
              placeholder="e.g. bank.com or private"
              className="h-9 w-48 text-xs"
              onKeyDown={(e) => e.key === 'Enter' && addRule()}
            />
          )}
          <Button size="sm" className="h-9 text-xs" onClick={addRule} disabled={!ruleValue.trim()}>Add rule</Button>
        </div>
      </div>

      <Separator />

      {/* notifications */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">Deadline notifications</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Sparse by design: only high-confidence items with a detected date within 24h, at most one per check while the app is open.
            </p>
          </div>
          <Switch
            checked={settings.notificationsEnabled}
            onCheckedChange={async (v) => {
              if (v) {
                const p = await requestNotificationPermission()
                setPerm(p)
                if (p !== 'granted') {
                  toast({ title: 'Permission not granted', description: 'The browser blocked notifications — in-app resurfacing still works.', variant: 'destructive' })
                  return
                }
              }
              await updateSettings({ notificationsEnabled: v })
            }}
            aria-label="Enable deadline notifications"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {notificationsSupported() ? `Browser permission: ${perm || 'unknown'}` : 'Notifications are not supported in this browser — in-app resurfacing still works.'}
          {' '}On iOS this may be unavailable; reliable background notifications arrive with the native (Capacitor) phase.
        </p>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 font-medium"><CalendarHeart className="h-4 w-4 text-muted-foreground" /> “On this day” resurfacing</p>
            <p className="text-xs leading-relaxed text-muted-foreground">Occasionally resurfaces old saves on their anniversary. Off by default; kept rare and low-pressure.</p>
          </div>
          <Switch checked={settings.onThisDay} onCheckedChange={(v) => updateSettings({ onThisDay: v })} aria-label="Enable on-this-day resurfacing" />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function StorageTab() {
  const [report, setReport] = useState<Awaited<ReturnType<typeof computeStorageReport>> | null>(null)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  useEffect(() => {
    void computeStorageReport().then(setReport)
  }, [])

  if (!report) return <div className="p-8 text-sm text-muted-foreground">measuring…</div>
  const pct = report.quota ? Math.min(100, (report.usage / report.quota) * 100) : 0

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <SectionTitle title="Storage budget" body="Everything lives in this browser's local storage on your device. Nothing is synced anywhere." />
      <div className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">Total used</span>
          <span className="text-sm tabular-nums">{fmtBytes(report.usage)}{report.quota ? ` / ${fmtBytes(report.quota)}` : ''}</span>
        </div>
        <Progress value={pct} className="h-2" />
        {report.quota ? <p className="text-[11px] text-muted-foreground">{pct.toFixed(1)}% of available browser storage</p> : <p className="text-[11px] text-muted-foreground">quota estimate unavailable in this browser</p>}
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <p className="mb-2 text-sm font-medium">By type</p>
        <div className="space-y-2">
          {report.breakdown
            .filter((b) => b.count > 0)
            .map((b) => (
              <div key={b.label}>
                <div className="flex items-baseline justify-between text-xs">
                  <span>{b.label} <span className="text-muted-foreground">× {b.count}</span></span>
                  <span className="tabular-nums text-muted-foreground">{fmtBytes(b.bytes)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, (b.bytes / Math.max(1, report.blobTotal)) * 100)}%` }} />
                </div>
              </div>
            ))}
          <div className="flex items-baseline justify-between border-t pt-2 text-xs">
            <span>Search index (embeddings, regenerable)</span>
            <span className="tabular-nums text-muted-foreground">{fmtBytes(report.indexTotal)}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
        <p className="text-sm font-medium">Storage-savers</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          “{report.audioWithTranscript > 0 ? `${report.audioWithTranscript} voice note${report.audioWithTranscript === 1 ? '' : 's'} have transcripts` : 'Voice notes with transcripts'}” — drop the original audio, keep the transcript.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={report.audioWithTranscript === 0 || busy}
          onClick={async () => {
            setBusy(true)
            try {
              const n = await dropTranscribedAudio()
              toast({ description: n ? `Removed ${n} audio file${n === 1 ? '' : 's'} — transcripts kept` : 'Nothing to remove' })
              setReport(await computeStorageReport())
            } finally {
              setBusy(false)
            }
          }}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete transcribed audio ({report.audioWithTranscript})
        </Button>
        <div className="pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await rebuildIndex()
                toast({ description: 'Rebuilding search index in the background' })
              } finally {
                setBusy(false)
              }
            }}
          >
            <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Rebuild search index
          </Button>
        </div>
        <div className="pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await clearPackCaches()
                toast({ description: 'Model caches cleared — packs are back to “not installed”' })
              } finally {
                setBusy(false)
              }
            }}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear cached intelligence models
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function DataTab() {
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <SectionTitle title="Your data" body="It all belongs to you: export everything as JSON, or wipe it entirely. No account means no lock-in." />
      <div className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
        <p className="font-medium">Export</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A complete JSON archive — fragments, extracted dates/urgency, threads and settings. Media files can be embedded as base64 (larger file).
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const blob = await exportAllData(false)
                downloadBlob(blob, `recall-export-${new Date().toISOString().slice(0, 10)}.json`)
                toast({ description: 'Export ready' })
              } finally {
                setBusy(false)
              }
            }}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export (text & metadata)
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const blob = await exportAllData(true)
                downloadBlob(blob, `recall-export-full-${new Date().toISOString().slice(0, 10)}.json`)
                toast({ description: 'Full export ready (includes media)' })
              } finally {
                setBusy(false)
              }
            }}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export with media
          </Button>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <p className="font-medium text-destructive">Delete everything</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Permanently removes all fragments, threads, extracted data and the search index from this device. Cannot be undone.
        </p>
        {!confirmWipe ? (
          <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => setConfirmWipe(true)}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete all data
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              onClick={async () => {
                await deleteAllData()
                await updateSettings({ ...DEFAULT_SETTINGS, setupComplete: true, packs: settings_packs_preserve() })
                setConfirmWipe(false)
                toast({ description: 'All data deleted' })
                window.location.reload()
              }}
            >
              Yes, delete everything
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setConfirmWipe(false)}>Cancel</Button>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground"><Smartphone className="h-4 w-4" /> Roadmap — native phase</p>
        <p>
          This PWA is built Capacitor-ready: reliable background resurfacing, native local notifications, a home-screen widget with your top 1–2 urgent items, and background jobs for periodic urgency checks arrive with the Android wrapper.
        </p>
        <p className="flex items-center gap-1.5 pt-1 font-medium text-foreground"><Info className="h-4 w-4" /> Memory Lens (planned)</p>
        <p>Query shortcuts like “what am I currently researching?” or “what have I been putting off?” — derived entirely from existing saved data, no new organization required.</p>
      </div>
    </div>
  )
}

function settings_packs_preserve() {
  // keep installed packs across a data wipe (they are code caches, not user data)
  return DEFAULT_SETTINGS.packs
}

function SectionTitle({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="font-display text-base font-semibold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}
