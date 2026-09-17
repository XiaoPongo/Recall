/**
 * Local date/deadline extraction (chrono-node runs entirely on-device).
 * Every extracted date carries a confidence level — we never present
 * inference as fact.
 */
import * as chrono from 'chrono-node'
import type { ExtractedDate } from '../types'

const VAGUE = /\b(next|coming|this)\s+(week|month|year)\b/i
const WEEKDAY_ONLY = /^(next\s+)?(mon|tues|wednes|thurs|fri|satur|sun)day\b/i
const TIME_ONLY = /^\s*(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)\s*$/i

function grade(text: string, hasMonth: boolean, hasDay: boolean, hasTime: boolean): 'high' | 'medium' | 'low' {
  if (VAGUE.test(text)) return 'low'
  if (hasMonth && hasDay) return 'high'
  if (hasMonth || (hasDay && hasTime)) return 'medium'
  if (WEEKDAY_ONLY.test(text.trim())) return 'medium'
  if (TIME_ONLY.test(text.trim())) return 'medium'
  if (hasDay) return 'medium'
  return 'low'
}

export function extractDates(text: string, now: Date = new Date()): ExtractedDate[] {
  if (!text) return []
  const results = chrono.parse(text, now, { forwardDate: true })
  const out: ExtractedDate[] = []
  for (const r of results) {
    const d = r.start.date()
    // only near-future matters for deadlines; allow slightly-past (today)
    const hours = (d.getTime() - now.getTime()) / 3_600_000
    if (hours < -24 || hours > 24 * 400) continue
    const s = r.start
    const hasMonth = s.isCertain('month')
    const hasDay = s.isCertain('day') || s.isCertain('weekday')
    const hasTime = s.isCertain('hour')
    out.push({
      date: d.toISOString(),
      source: r.text.trim(),
      confidence: grade(r.text, hasMonth, hasDay, hasTime),
    })
    if (out.length >= 3) break
  }
  return out
}

/** nearest future date (ms) among extracted dates */
export function nearestFutureDateMs(dates: ExtractedDate[]): number | null {
  const now = Date.now()
  const future = dates
    .map((d) => new Date(d.date).getTime())
    .filter((t) => t > now)
    .sort((a, b) => a - b)
  return future[0] ?? null
}

/** nearest date overall — upcoming first, otherwise the most recent past one (for the Overdue agenda) */
export function nearestAnyDateMs(dates: ExtractedDate[]): number | null {
  const now = Date.now()
  const times = dates.map((d) => new Date(d.date).getTime()).sort((a, b) => a - b)
  const future = times.filter((t) => t > now)
  if (future.length) return future[0]
  return times.length ? times[times.length - 1] : null
}
