/**
 * Natural-language time parsing for queries: "last week", "this month",
 * "around when I saved the Tokyo stuff".
 */

export interface TimeWindow {
  from: number
  to: number
  label: string
}

const DAY = 86_400_000

export function parseTimeExpression(q: string, now = new Date()): TimeWindow | null {
  const s = q.toLowerCase()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

  if (/\b(today|this day)\b/.test(s)) {
    const from = startOfDay(now)
    return { from, to: from + DAY, label: 'today' }
  }
  if (/\byesterday\b/.test(s)) {
    const from = startOfDay(now) - DAY
    return { from, to: from + DAY, label: 'yesterday' }
  }
  if (/\bthis week\b/.test(s)) {
    const day = now.getDay() === 0 ? 7 : now.getDay()
    const from = startOfDay(now) - (day - 1) * DAY
    return { from, to: Date.now() + DAY, label: 'this week' }
  }
  if (/\blast week\b/.test(s)) {
    const day = now.getDay() === 0 ? 7 : now.getDay()
    const monday = startOfDay(now) - (day - 1) * DAY
    return { from: monday - 7 * DAY, to: monday, label: 'last week' }
  }
  if (/\bthis month\b/.test(s)) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    return { from, to: Date.now() + DAY, label: 'this month' }
  }
  if (/\blast month\b/.test(s)) {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
    const to = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    return { from, to, label: 'last month' }
  }
  const pastDays = s.match(/\b(last|past)\s+(\d+)\s+(day|days|week|weeks|month|months)\b/)
  if (pastDays) {
    const n = parseInt(pastDays[2], 10)
    const mult = pastDays[3].startsWith('week') ? 7 : pastDays[3].startsWith('month') ? 30 : 1
    return { from: Date.now() - n * mult * DAY, to: Date.now() + DAY, label: `past ${n} ${pastDays[3]}` }
  }
  return null
}

/**
 * "around when I saved the Tokyo stuff" → anchor mode.
 * Returns the anchor phrase remainder ("Tokyo stuff") when detected.
 */
export function parseAnchorQuery(q: string): string | null {
  const m = q
    .toLowerCase()
    .match(
      /\b(?:when i saved|around (?:when |the )?(?:time )?i (?:saved|kept)|back when i (?:saved|kept))\s+(?:the\s+|my\s+|those\s+)?(?<rest>.+)$/
    )
  const rest = m?.groups?.rest?.trim()
  if (!rest) return null
  // drop trailing "stuff/things/notes"
  const cleaned = rest.replace(/\b(stuff|things|notes|items|files)\b/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.length >= 3 ? cleaned : rest
}
