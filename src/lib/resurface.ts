/**
 * Passive resurfacing — the app nudges you; it never demands attention.
 * Sparse and high-signal by design. PWA phase: in-app + browser
 * notifications where the platform allows. (Reliable background
 * resurfacing + home-screen widget arrive with the Capacitor phase.)
 */
import type { AppSettings, Fragment, ResurfaceItem, Thread } from './types'
import { nearestFutureDateMs } from './pipeline/dates'

const DAY = 86_400_000

function isResurfaceable(f: Fragment, now: number): boolean {
  if (f.suppressed || f.dismissedAt) return false
  if (f.snoozedUntil && f.snoozedUntil > now) return false
  return true
}

export function computeResurfaceItems(
  fragments: Fragment[],
  threads: Thread[],
  settings: AppSettings,
  now: number = Date.now()
): ResurfaceItem[] {
  void threads
  const items: ResurfaceItem[] = []
  const cool = (f: Fragment) => !f.lastSurfacedAt || now - f.lastSurfacedAt > DAY

  // 1. deadline-soon: nearest detected date within 72h (or high urgency within 7d)
  const deadlineItems: ResurfaceItem[] = []
  for (const f of fragments) {
    if (!isResurfaceable(f, now) || !cool(f)) continue
    const nearest = nearestFutureDateMs(f.extracted.dates ?? [])
    let note = ''
    if (nearest !== null) {
      const hours = (nearest - now) / 3_600_000
      const conf = f.extracted.dates.find((d) => new Date(d.date).getTime() === nearest)?.confidence ?? 'low'
      if (hours <= 72) {
        note = `Possible ${f.extracted.category?.label === 'meeting' ? 'meeting' : 'deadline'}: ${fmt(nearest)} — ${conf} confidence`
      }
    }
    if (!note && f.extracted.urgency.level === 'high') {
      const days = nearest !== null ? (nearest - now) / DAY : Infinity
      if (days <= 7) {
        note = `Looks time-sensitive (${f.extracted.urgency.signals[0] ?? 'urgent wording'}) — ${f.extracted.urgency.confidence} confidence`
      }
    }
    if (note) deadlineItems.push({ fragment: f, reason: 'deadline-soon', note })
  }
  deadlineItems.sort((a, b) => (nearestFutureDateMs(a.fragment.extracted.dates) ?? Infinity) - (nearestFutureDateMs(b.fragment.extracted.dates) ?? Infinity))
  items.push(...deadlineItems.slice(0, 3))

  // 2. decay — one long-forgotten fragment, only when nothing urgent is shown
  if (items.length === 0) {
    const decayed = fragments
      .filter(
        (f) =>
          isResurfaceable(f, now) &&
          now - f.createdAt > 30 * DAY &&
          (f.openCount ?? 0) === 0 &&
          !f.lastSurfacedAt
      )
      .sort((a, b) => a.createdAt - b.createdAt)
    if (decayed.length && Math.random() < 0.7) {
      const f = decayed[Math.floor(Math.random() * Math.min(3, decayed.length))]
      const months = Math.round((now - f.createdAt) / (30 * DAY))
      items.push({
        fragment: f,
        reason: 'decay',
        note: `Saved ${months} month${months === 1 ? '' : 's'} ago — still relevant?`,
      })
    }
  }

  // 3. on-this-day — opt-in, rare, low-pressure
  if (settings.onThisDay && items.length === 0) {
    const today = new Date(now)
    const hit = fragments.find((f) => {
      if (!isResurfaceable(f, now) || f.lastSurfacedAt) return false
      const d = new Date(f.createdAt)
      return (
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        now - f.createdAt > 330 * DAY
      )
    })
    if (hit) {
      const years = Math.floor((now - hit.createdAt) / (365 * DAY))
      items.push({
        fragment: hit,
        reason: 'on-this-day',
        note: `On this day ${years} year${years === 1 ? '' : 's'} ago, you saved this`,
      })
    }
  }

  return items
}

export interface DigestInfo {
  count: number
  due: boolean
}

/** weekly digest — "X things you saved this week look time-sensitive" */
export function computeDigest(fragments: Fragment[], settings: AppSettings, now = Date.now()): DigestInfo {
  const weekAgo = now - 7 * DAY
  const count = fragments.filter((f) => {
    if (f.createdAt < weekAgo || f.suppressed || f.dismissedAt) return false
    const nearest = nearestFutureDateMs(f.extracted.dates ?? [])
    return Boolean(nearest) || f.extracted.urgency.level === 'high' || f.extracted.urgency.level === 'medium'
  }).length
  const due = count >= 2 && (!settings.lastDigestAt || now - settings.lastDigestAt > 7 * DAY)
  return { count, due }
}

/** fragments with deadlines in the next 24h that were never notified — for the sparse notification path */
export function fragmentsToNotify(fragments: Fragment[], now = Date.now()): Fragment[] {
  return fragments.filter((f) => {
    if (f.notifiedAt || f.suppressed || f.dismissedAt) return false
    if (f.extracted.urgency.level !== 'high') return false
    const nearest = nearestFutureDateMs(f.extracted.dates ?? [])
    if (nearest === null) return false
    const hours = (nearest - now) / 3_600_000
    return hours > 0 && hours <= 24
  })
}

function fmt(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `today ${time}`
  const tomorrow = new Date(today.getTime() + DAY)
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}
