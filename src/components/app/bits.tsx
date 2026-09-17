'use client'

/**
 * Shared presentational bits — brand mark, badges, chips.
 * Tone: calm and human. Confidence is always hedged, never alarmist
 * (soft pills, friendly wording) unless something is genuinely urgent.
 */
import { AudioLines, FileText, Image as ImageIcon, Link2, Loader2, ShieldCheck, StickyNote } from 'lucide-react'
import type { Confidence, FragmentType, UrgencyLevel } from '@/lib/types'
import { cn } from '@/lib/utils'

export function RippleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="rm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9266" />
          <stop offset="1" stopColor="#cc3d1e" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#rm)" />
      <g stroke="#fff6ee" strokeWidth="30" strokeLinecap="round" fill="none">
        <circle cx="256" cy="256" r="46" />
        <path d="M 256 128 a 128 128 0 0 1 128 128" opacity="0.92" />
        <path d="M 256 384 a 128 128 0 0 1 -128 -128" opacity="0.92" />
        <path d="M 256 76 a 180 180 0 0 1 180 180" opacity="0.55" />
        <path d="M 256 436 a 180 180 0 0 1 -180 -180" opacity="0.55" />
      </g>
    </svg>
  )
}

export function TypeIcon({ type, className }: { type: FragmentType; className?: string }) {
  const props = { className: cn('h-4 w-4 shrink-0', className) }
  switch (type) {
    case 'link':
      return <Link2 {...props} />
    case 'image':
      return <ImageIcon {...props} />
    case 'pdf':
      return <FileText {...props} />
    case 'audio':
      return <AudioLines {...props} />
    default:
      return <StickyNote {...props} />
  }
}

export const TYPE_LABEL: Record<FragmentType, string> = {
  text: 'Text',
  link: 'Link',
  image: 'Screenshot',
  pdf: 'PDF',
  audio: 'Voice note',
}

/** persistent privacy promise indicator */
export function LocalBadge({ compact }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-emerald-600/25 bg-emerald-600/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-400',
        compact && 'px-1.5'
      )}
      title="All storage and processing happen on this device. Nothing is uploaded."
    >
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
      {!compact && 'Local only'}
    </span>
  )
}

/** soft, calm pill — never styled like a warning */
export function ConfidenceChip({ kind, confidence }: { kind: string; confidence: Confidence }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        confidence === 'high' &&
          'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
        confidence === 'medium' &&
          'bg-amber-500/15 text-amber-700 dark:bg-amber-300/15 dark:text-amber-300',
        confidence === 'low' &&
          'bg-muted text-muted-foreground'
      )}
      title={`Inferred from local analysis — ${confidence} confidence`}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          confidence === 'high' && 'bg-emerald-500 dark:bg-emerald-400',
          confidence === 'medium' && 'bg-amber-500 dark:bg-amber-300',
          confidence === 'low' && 'bg-muted-foreground/50'
        )}
      />
      {kind}
      <span className="opacity-70">· {confidence} confidence</span>
    </span>
  )
}

export function UrgencyDot({ level }: { level: UrgencyLevel }) {
  if (level === 'none') return null
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        level === 'high' && 'bg-rose-500',
        level === 'medium' && 'bg-amber-400',
        level === 'low' && 'bg-stone-400 dark:bg-stone-500'
      )}
      title={`Urgency: ${level}`}
      aria-label={`urgency ${level}`}
    />
  )
}

export function ProcessingBadge({ status }: { status: 'raw' | 'processing' | 'ready' | 'partial' }) {
  if (status === 'ready') return null
  if (status === 'processing' || status === 'raw') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        processing
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-300/15 dark:text-amber-300"
      title="Some processing steps failed — the fragment is still saved and searchable"
    >
      partly processed — still searchable
    </span>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border/90 bg-card/50 px-6 py-12 text-center">
      {icon && <div className="text-primary/40">{icon}</div>}
      <div className="font-display text-lg font-semibold tracking-tight">{title}</div>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}
