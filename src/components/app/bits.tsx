'use client'

/**
 * Shared presentational bits — brand mark, badges, chips.
 */
import { AudioLines, FileText, Image as ImageIcon, Link2, Loader2, ShieldCheck, StickyNote } from 'lucide-react'
import type { Confidence, FragmentType, UrgencyLevel } from '@/lib/types'
import { cn } from '@/lib/utils'

export function RippleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="rm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#92400e" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#rm)" />
      <g stroke="#fffbeb" strokeWidth="30" strokeLinecap="round" fill="none">
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
        'inline-flex items-center gap-1.5 rounded-full border border-emerald-600/25 bg-emerald-600/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-400',
        compact && 'px-1.5'
      )}
      title="All storage and processing happen on this device. Nothing is uploaded."
    >
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
      {!compact && 'Local only'}
    </span>
  )
}

export function ConfidenceChip({ kind, confidence }: { kind: string; confidence: Confidence }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium',
        confidence === 'high' && 'text-emerald-600 dark:text-emerald-400',
        confidence === 'medium' && 'text-amber-600 dark:text-amber-400',
        confidence === 'low' && 'text-stone-500 dark:text-stone-400'
      )}
      title={`Inferred from local analysis — ${confidence} confidence`}
    >
      {kind}
      <span className="opacity-60">· {confidence} confidence</span>
    </span>
  )
}

export function UrgencyDot({ level }: { level: UrgencyLevel }) {
  if (level === 'none') return null
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        level === 'high' && 'bg-red-500',
        level === 'medium' && 'bg-amber-500',
        level === 'low' && 'bg-stone-400'
      )}
      title={`Urgence: ${level}`}
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
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400" title="Some processing steps failed — the fragment is still saved and searchable">
      partially processed
    </span>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <div className="font-medium">{title}</div>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}
