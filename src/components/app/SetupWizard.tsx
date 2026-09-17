'use client'

/**
 * First-run setup — local intelligence download.
 * Honest about sizes; Basic mode (built-in keyword engine) always available.
 */
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Download, Loader2, ShieldCheck, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { LocalBadge, RippleMark } from './bits'
import { PACKS, downloadPack, subscribePackProgress, type PackProgress } from '@/lib/ml/packs'
import { updateSettings } from '@/lib/db'
import { requestNotificationPermission } from '@/lib/notify'
import type { PackId } from '@/lib/types'
import { cn } from '@/lib/utils'

type Phase = 'welcome' | 'picks' | 'download' | 'done'

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>('welcome')
  const [picks, setPicks] = useState<Record<PackId, boolean>>({ semantic: true, vision: false, voice: false, documents: false })
  const [progress, setProgress] = useState<Partial<Record<PackId, PackProgress>>>({})
  const [failed, setFailed] = useState<Partial<Record<PackId, boolean>>>({})
  const [attempted, setAttempted] = useState<Partial<Record<PackId, boolean>>>({})
  const [notifyOptIn, setNotifyOptIn] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => subscribePackProgress((p) => setProgress((prev) => ({ ...prev, [p.id]: p }))), [])

  const chosen = PACKS.filter((p) => picks[p.id])
  const totalMB = chosen.reduce((s, p) => s + p.approxMB, 0)

  async function begin() {
    if (startedRef.current) return
    startedRef.current = true
    setAttempted(Object.fromEntries(chosen.map((p) => [p.id, true])))
    setPhase('download')
    for (const pack of chosen) {
      try {
        await downloadPack(pack.id)
      } catch {
        setFailed((f) => ({ ...f, [pack.id]: true }))
      }
    }
    setPhase('done')
  }

  async function finish() {
    if (notifyOptIn) {
      const perm = await requestNotificationPermission()
      await updateSettings({ notificationsEnabled: perm === 'granted' })
    }
    await updateSettings({
      setupComplete: true,
      setupMode: anySucceeded ? 'enhanced' : 'basic',
    })
    onComplete()
  }

  const anySucceeded = chosen.some((p) => attempted[p.id] && !failed[p.id])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-lg"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <RippleMark className="h-16 w-16 rounded-3xl shadow-xl shadow-primary/25" />
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Recall</h1>
            <p className="text-sm text-muted-foreground">Your private, offline second memory</p>
          </div>
          <LocalBadge />
        </div>

        {phase === 'welcome' && (
          <div className="space-y-5 rounded-3xl border bg-card p-6 shadow-lg shadow-primary/5">
            <div className="space-y-3">
              {[
                { icon: <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, t: 'Nothing is uploaded', d: 'No account, no cloud, no tracking. All processing runs on this device.' },
                { icon: <WifiOff className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, t: 'Works offline', d: 'Capture and search work without any network after first load.' },
                { icon: <Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />, t: 'No organization needed', d: 'Dump fragments in. Find them later with plain-language search.' },
              ].map((row) => (
                <div key={row.t} className="flex gap-3">
                  <div className="mt-0.5">{row.icon}</div>
                  <div>
                    <div className="text-sm font-medium">{row.t}</div>
                    <div className="text-sm text-muted-foreground">{row.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <Button className="w-full" size="lg" onClick={() => setPhase('picks')}>
              Set up your private memory <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}

        {phase === 'picks' && (
          <div className="space-y-4 rounded-3xl border bg-card p-6 shadow-lg shadow-primary/5">
            <div>
              <h2 className="font-display text-lg font-semibold">Local intelligence</h2>
              <p className="text-sm text-muted-foreground">
                Downloads once (~{totalMB} MB), then everything runs offline on this device.
              </p>
            </div>
            <div className="space-y-2">
              {PACKS.map((p) => (
                <label
                  key={p.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                    picks[p.id] ? 'border-primary/40 bg-accent/50' : 'hover:bg-muted/50'
                  )}
                >
                  <Checkbox
                    checked={picks[p.id]}
                    onCheckedChange={(v) => setPicks((prev) => ({ ...prev, [p.id]: v === true }))}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {p.name}
                      {p.id === 'semantic' && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">recommended</span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">~{p.approxMB} MB · {p.requires.join(', ')}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={begin} disabled={chosen.length === 0}>
                {chosen.length === 0 ? 'Continue with Basic mode' : `Download ${chosen.length} pack${chosen.length > 1 ? 's' : ''} (~${totalMB} MB)`} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => { startedRef.current = true; setPhase('done') }}>
                Skip — start with Basic mode
              </Button>
            </div>
          </div>
        )}

        {phase === 'download' && (
          <div className="space-y-4 rounded-3xl border bg-card p-6 shadow-lg shadow-primary/5">
            <div>
              <h2 className="font-display text-lg font-semibold">Setting up your private memory…</h2>
              <p className="text-sm text-muted-foreground">Downloading local intelligence — nothing is uploaded.</p>
            </div>
            {chosen.map((p) => {
              const pr = progress[p.id]
              return (
                <div key={p.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {pr?.status === 'error' ? 'failed — can retry later in Settings' : pr ? `${Math.round(pr.pct)}%` : 'waiting…'}
                    </span>
                  </div>
                  <Progress value={pr?.pct ?? 0} className="h-1.5" />
                  {pr?.note && <p className="truncate text-[11px] text-muted-foreground">{pr.note}</p>}
                </div>
              )
            })}
            {chosen.every((p) => (progress[p.id]?.status ?? 'downloading') === 'ready' || failed[p.id]) && (
              <Button className="w-full" size="lg" onClick={finish}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Ready — continue
              </Button>
            )}
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-4 rounded-3xl border bg-card p-6 shadow-lg shadow-primary/5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              <div>
                <h2 className="font-display text-lg font-semibold">{anySucceeded ? 'Ready — everything stays on this device.' : 'Ready (Basic mode).'}</h2>
                <p className="text-sm text-muted-foreground">
                  {anySucceeded
                    ? 'Capture anything. Search with plain language. Nothing to organize.'
                    : 'Keyword search works now. You can download intelligence packs later in Settings.'}
                </p>
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
              <Checkbox checked={notifyOptIn} onCheckedChange={(v) => setNotifyOptIn(v === true)} className="mt-0.5" />
              <span className="text-sm">
                Notify me about detected deadlines <span className="text-muted-foreground">(sparse — only clear, time-sensitive items)</span>
              </span>
            </label>
            <Button className="w-full" size="lg" onClick={finish}>
              Start remembering <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}

        {phase === 'download' && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> you can keep this open — it finishes by itself
          </div>
        )}
      </motion.div>
    </div>
  )
}
