/** display helpers */
import { formatDistanceToNowStrict, isThisWeek, isToday, isTomorrow, isYesterday } from 'date-fns'

export function relTime(t: number): string {
  const diff = Date.now() - t
  if (diff < 45_000) return 'just now'
  return formatDistanceToNowStrict(new Date(t), { addSuffix: true })
}

export function dayLabel(t: number): string {
  const d = new Date(t)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  if (isThisWeek(d)) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}

export function dateTimeLabel(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (isToday(d)) return `${time} today`
  if (isTomorrow(d)) return `${time} tomorrow`
  if (d.getFullYear() === today.getFullYear()) {
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`
  }
  return `${d.toLocaleDateString([], { dateStyle: 'medium' })}, ${time}`
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function truncate(s: string, n = 140): string {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function confidenceStyle(c: string): string {
  switch (c) {
    case 'high':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'medium':
      return 'text-amber-600 dark:text-amber-400'
    default:
      return 'text-stone-500 dark:text-stone-400'
  }
}
