'use client'

/**
 * Fragment detail — content, everything the local pipeline extracted
 * (with confidence labels), and the reconstructed "Why did I save this?"
 * context: temporal neighbors, thread, similarity.
 */
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, ExternalLink, Eye, EyeOff, Layers, Link2, ShieldOff, Sparkles, Trash2, Clock, Copy as CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { db } from '@/lib/db'
import type { Fragment, Thread } from '@/lib/types'
import { deleteFragment, forgetTopic, markOpened } from '@/lib/capture'
import { relatedContext, type RelatedFragment } from '@/lib/pipeline/threads'
import { dateTimeLabel, domainOf, relTime } from '@/lib/format'
import { ConfidenceChip, TypeIcon, UrgencyDot } from './bits'
import { CopyButton } from './FragmentCard'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

export function FragmentDetail({ fragments, threads }: { fragments: Fragment[]; threads: Thread[] }) {
  const selectedFragmentId = useUI((s) => s.selectedFragmentId)
  const openFragment = useUI((s) => s.openFragment)
  const fragment = fragments.find((f) => f.id === selectedFragmentId) ?? null

  return (
    <Dialog open={!!selectedFragmentId} onOpenChange={(open) => !open && openFragment(null)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto scroll-slim sm:max-w-2xl">
        {fragment ? (
          <FragmentDetailInner key={fragment.id} fragment={fragment} fragments={fragments} threads={threads} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function FragmentDetailInner({
  fragment: f,
  fragments,
  threads,
}: {
  fragment: Fragment
  fragments: Fragment[]
  threads: Thread[]
}) {
  const openFragment = useUI((s) => s.openFragment)
  const openThread = useUI((s) => s.openThread)
  const { toast } = useToast()

  const [context, setContext] = useState<Awaited<ReturnType<typeof relatedContext>> | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const objectUrl = useMemo(() => (f.blob ? URL.createObjectURL(f.blob) : null), [f.blob])

  useEffect(() => {
    void markOpened(f.id)
    void relatedContext(f).then(setContext)
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [f, objectUrl])

  const thread = f.threadId ? threads.find((t) => t.id === f.threadId) : undefined
  const dupRef = f.duplicateOf
  const dupOriginal = dupRef ? fragments.find((x) => x.id === dupRef.id) : undefined

  async function remove() {
    await deleteFragment(f.id)
    openFragment(null)
    toast({ description: 'Deleted' })
  }

  async function toggleNeverProcess(v: boolean) {
    const fresh = await db.fragments.get(f.id)
    if (!fresh) return
    fresh.neverProcess = v
    await db.fragments.put(fresh)
    toast({
      description: v
        ? 'Excluded from OCR, embeddings and indexing — visible only in the type drawer'
        : 'Re-included in processing',
    })
  }

  async function snooze() {
    const fresh = await db.fragments.get(f.id)
    if (!fresh) return
    fresh.snoozedUntil = Date.now() + 7 * 86_400_000
    await db.fragments.put(fresh)
    toast({ description: 'Snoozed from resurfacing for a week' })
  }

  return (
    <>
      <DialogHeader className="space-y-1.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <TypeIcon type={f.type} className="h-4.5 w-4.5 text-primary" />
            <span className="capitalize">{f.type === 'image' ? 'Screenshot' : f.type === 'audio' ? 'Voice note' : f.type}</span>
            <UrgencyDot level={f.extracted.urgency.level} />
            {f.origin === 'seed' && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">sample</span>
            )}
          </DialogTitle>
          <DialogDescription>
            saved {relTime(f.createdAt)} · {dateTimeLabel(f.createdAt)} · from {f.origin}
          </DialogDescription>
        </DialogHeader>

        {/* content */}
        <div className="space-y-3">
          {f.type === 'image' && (objectUrl || f.thumb) && (
            <img
              src={objectUrl ?? f.thumb!}
              alt="Saved screenshot (kept on this device)"
              className="max-h-[46dvh] w-full rounded-xl border object-contain"
            />
          )}
          {f.type === 'audio' && objectUrl && <audio controls src={objectUrl} className="w-full" />}
          {f.type === 'pdf' && objectUrl && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => window.open(objectUrl, '_blank')}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open PDF
              </Button>
              <span className="self-center text-xs text-muted-foreground">{f.rawContent}</span>
            </div>
          )}
          {f.type === 'link' && (
            <a
              href={f.rawContent}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm font-medium leading-snug break-all hover:border-primary/40"
            >
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                {f.textContent || f.rawContent}
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{domainOf(f.rawContent)}</span>
              </span>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          )}
          {(f.type === 'text' || f.type === 'pdf' || f.type === 'audio') && (
            <p className="whitespace-pre-wrap break-words rounded-xl border bg-muted/30 p-3 text-sm leading-relaxed">
              {f.textContent || f.rawContent || <span className="text-muted-foreground">no text extracted yet</span>}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <CopyButton text={f.type === 'link' ? f.rawContent : (f.textContent || f.rawContent)} label={f.type === 'link' ? 'Copy link' : 'Copy text'} />
            {f.type === 'audio' && f.blob && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={async () => {
                  const a = document.createElement('a')
                  a.href = objectUrl!
                  a.download = f.rawContent || 'voice-note'
                  a.click()
                }}
              >
                Save audio file
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={snooze}>
              <Clock className="mr-1.5 h-3.5 w-3.5" /> Snooze resurfacing
            </Button>
          </div>
        </div>

        {/* duplicates */}
        {f.duplicateOf && (
          <div className="flex items-center gap-2 rounded-2xl border border-primary/25 bg-primary/10 p-3 text-sm">
            <CopyIcon className="h-4 w-4 text-primary" />
            <span className="flex-1">
              Possibly saved before
              {dupOriginal && (
                <button className="ml-1 underline decoration-dotted underline-offset-2" onClick={() => openFragment(dupOriginal.id)}>
                  view the earlier one
                </button>
              )}
              <span className="ml-1 text-xs text-muted-foreground">({f.duplicateOf.confidence} confidence)</span>
            </span>
            {dupOriginal && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={async () => {
                  await deleteFragment(f.id)
                  openFragment(dupOriginal.id)
                  toast({ description: 'Merged — duplicate removed, original kept' })
                }}
              >
                Merge
              </Button>
            )}
          </div>
        )}

        {/* what the pipeline extracted — always confidence-labeled */}
        {(f.extracted.dates.length > 0 || f.extracted.urgency.level !== 'none' || f.extracted.category) && (
          <div className="space-y-2 rounded-2xl border p-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Extracted on this device
            </div>
            {f.extracted.dates.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <CalendarClock className="h-4 w-4 text-primary" />
                <span>Possible {f.extracted.category?.label === 'meeting' ? 'meeting' : 'deadline'}: {dateTimeLabel(new Date(d.date).getTime())}</span>
                <span className="ml-auto">
                  <ConfidenceChip kind={d.source} confidence={d.confidence} />
                </span>
              </div>
            ))}
            {f.extracted.urgency.level !== 'none' && (
              <div className="flex items-center gap-2 text-sm">
                <UrgencyDot level={f.extracted.urgency.level} />
                <span>Looks {f.extracted.urgency.level}-priority</span>
                {f.extracted.urgency.signals.length > 0 && (
                  <span className="text-xs text-muted-foreground">({f.extracted.urgency.signals.slice(0, 2).join('; ')})</span>
                )}
                <span className="ml-auto">
                  <ConfidenceChip kind="urgency" confidence={f.extracted.urgency.confidence} />
                </span>
              </div>
            )}
            {f.extracted.category && (
              <div className="flex items-center gap-2 text-sm">
                <span>Likely a “{f.extracted.category.label}”</span>
                <span className="ml-auto">
                  <ConfidenceChip kind="category" confidence={f.extracted.category.confidence} />
                </span>
              </div>
            )}
          </div>
        )}

        {/* WHY DID I SAVE THIS? */}
        <div className="space-y-2 rounded-2xl border border-primary/25 bg-accent/40 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground">
            <Eye className="h-3.5 w-3.5" /> Why did I save this?
          </div>
          {context === null ? (
            <p className="text-sm text-muted-foreground">Reconstructing context…</p>
          ) : (
            <>
              {context.note && <p className="text-sm leading-relaxed">{context.note}</p>}
              {thread && !context.note && (
                <p className="text-sm leading-relaxed">
                  Part of <span className="font-medium">{thread.title}</span> — {thread.summary}
                </p>
              )}
              {context.neighbors.length > 0 ? (
                <div className="space-y-1.5 pt-1">
                  {context.neighbors.slice(0, 4).map((r: RelatedFragment) => (
                    <button
                      key={r.fragment.id}
                      className="flex w-full items-center gap-2 rounded-lg border bg-card/70 px-2.5 py-1.5 text-left text-xs hover:border-primary/40"
                      onClick={() => openFragment(r.fragment.id)}
                    >
                      <TypeIcon type={r.fragment.type} className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{(r.fragment.textContent || r.fragment.rawContent).slice(0, 90)}</span>
                      <span className="shrink-0 text-muted-foreground">{r.reason}</span>
                    </button>
                  ))}
                </div>
              ) : (
                !context.note && <p className="text-sm text-muted-foreground">No strong context found — this one stands alone (so far).</p>
              )}
            </>
          )}
        </div>

        <Separator />

        {/* privacy + lifecycle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldOff className="h-4 w-4 text-muted-foreground" /> Never process this fragment
              </div>
              <p className="text-xs text-muted-foreground">Excludes it from OCR, embeddings and search indexing. It stays visible in the type drawer.</p>
            </div>
            <Switch checked={!!f.neverProcess} onCheckedChange={toggleNeverProcess} aria-label="Never process this fragment" />
          </div>

          <div className="flex flex-wrap gap-2">
            {thread && (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => openThread(thread.id)}>
                <Layers className="mr-1.5 h-3.5 w-3.5" /> {thread.title}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={async () => {
                await forgetTopic(f.id)
                toast({ description: "Topic suppressed from resurfacing — data kept, still searchable" })
              }}
            >
              <EyeOff className="mr-1.5 h-3.5 w-3.5" /> Forget this topic
            </Button>
            {!confirmDelete ? (
              <Button variant="ghost" size="sm" className="ml-auto h-8 text-xs text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
              </Button>
            ) : (
              <AnimatePresence>
                <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={cn('ml-auto flex items-center gap-2')}>
                  <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={remove}>
                    Delete permanently
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </div>
    </>
  )
}
