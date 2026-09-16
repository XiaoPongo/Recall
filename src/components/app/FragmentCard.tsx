'use client'

import { AudioLines, CalendarClock, Copy, Layers, Link2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import type { Fragment, Thread } from '@/lib/types'
import { dateTimeLabel, domainOf, relTime, truncate } from '@/lib/format'
import { nearestFutureDateMs } from '@/lib/pipeline/dates'
import { ProcessingBadge, TypeIcon, UrgencyDot } from './bits'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

export function DeadlineChip({ fragment }: { fragment: Fragment }) {
  const nearest = nearestFutureDateMs(fragment.extracted.dates ?? [])
  if (nearest === null) return null
  const conf = fragment.extracted.dates.find((d) => new Date(d.date).getTime() === nearest)?.confidence ?? 'low'
  const label = fragment.extracted.category?.label === 'meeting' ? 'meeting' : 'deadline'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        nearest - Date.now() < 36 * 3_600_000
          ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          : 'border-primary/30 bg-primary/10 text-primary'
      )}
      title={`Detected locally — ${conf} confidence. Source: “${fragment.extracted.dates.find((d) => new Date(d.date).getTime() === nearest)?.source ?? ''}”`}
    >
      <CalendarClock className="h-3 w-3" />
      {label}: {dateTimeLabel(nearest)}
      <span className="opacity-60">· {conf}</span>
    </span>
  )
}

export function FragmentCard({
  fragment,
  thread,
  reasons,
}: {
  fragment: Fragment
  thread?: Thread
  reasons?: string[]
}) {
  const openFragment = useUI((s) => s.openFragment)
  const { toast } = useToast()
  const isUrl = fragment.type === 'link'

  return (
    <article
      className="group cursor-pointer rounded-2xl border bg-card p-3.5 shadow-sm transition-all hover:shadow-md hover:border-primary/30"
      onClick={() => openFragment(fragment.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && openFragment(fragment.id)}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <TypeIcon type={fragment.type} />
        </div>
        <div className="min-w-0 flex-1">
          {/* first line: content preview */}
          {fragment.type === 'image' && fragment.thumb ? (
            <img
              src={fragment.thumb}
              alt={truncate(fragment.textContent || 'Saved screenshot', 80)}
              className="mb-2 max-h-52 w-full rounded-xl border object-cover"
              loading="lazy"
            />
          ) : fragment.type === 'audio' ? (
            <div className="mb-2 flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
              <AudioLines className="h-4 w-4 text-primary" />
              {fragment.blob ? (
                <audio
                  controls
                  preload="none"
                  src={URL.createObjectURL(fragment.blob)}
                  className="h-8 w-full max-w-72"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="text-xs text-muted-foreground">audio removed — transcript kept</span>
              )}
            </div>
          ) : null}

          {isUrl ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="break-all font-medium">{truncate(fragment.textContent || fragment.rawContent, 90)}</span>
              {domainOf(fragment.rawContent) && (
                <span className="text-xs text-muted-foreground">{domainOf(fragment.rawContent)}</span>
              )}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {truncate(fragment.textContent || fragment.rawContent, fragment.type === 'pdf' ? 120 : 220)}
            </p>
          )}

          {fragment.type === 'pdf' && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium">{fragment.rawContent}</span>
            </p>
          )}

          {/* chips row */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="text-[11px] text-muted-foreground" title={dateTimeLabel(fragment.createdAt)}>
              {relTime(fragment.createdAt)}
            </span>
            <UrgencyDot level={fragment.extracted.urgency.level} />
            <DeadlineChip fragment={fragment} />
            {fragment.duplicateOf && (
              <Badge variant="outline" className="h-5 border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                <Copy className="mr-1 h-3 w-3" /> saved before
              </Badge>
            )}
            {thread && !thread.suppressed && (
              <button
                className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  useUI.getState().openThread(thread.id)
                }}
              >
                <Layers className="h-3 w-3" /> {thread.title}
              </button>
            )}
            {fragment.neverProcess && (
              <Badge variant="outline" className="h-5 px-1.5 text-[11px]">never processed</Badge>
            )}
            <ProcessingBadge status={fragment.processing.status} />
            {reasons && reasons.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1">
                {reasons.slice(0, 3).map((r, i) => (
                  <span key={i} className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                    {r}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { toast } = useToast()
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 text-xs"
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(text)
          toast({ description: 'Copied' })
        } catch {
          toast({ title: 'Copy failed', variant: 'destructive' })
        }
      }}
    >
      <Copy className="mr-1.5 h-3.5 w-3.5" /> {label ?? 'Copy'}
    </Button>
  )
}
