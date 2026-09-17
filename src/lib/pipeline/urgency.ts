/**
 * Local urgency scoring — keyword signals + detected-date proximity.
 * Confidence is always attached; "Possible deadline — Medium confidence".
 */
import type { ExtractedDate, UrgencyInfo } from '../types'
import { nearestFutureDateMs } from './dates'

interface Signal {
  re: RegExp
  weight: number
  label: string
}

const SIGNALS: Signal[] = [
  { re: /\b(don'?t forget|do not forget|remember to)\b/i, weight: 26, label: "explicit 'don't forget'" },
  { re: /\b(urgent|asap|immediately|right away)\b/i, weight: 24, label: 'urgency wording' },
  { re: /\bdeadline\b/i, weight: 20, label: "mentions 'deadline'" },
  { re: /\bdue\b/i, weight: 16, label: "mentions 'due'" },
  { re: /\b(remind(er)?|reminder)\b/i, weight: 14, label: 'reminder language' },
  { re: /\b(meeting|standup|sync|call|zoom|google meet|teams|interview|appointment|doctor|dentist)\b/i, weight: 13, label: 'event/meeting language' },
  { re: /\b(expire[sd]?|expiration|overdue)\b/i, weight: 14, label: 'expiry language' },
  { re: /\b(submit|apply|register|renew|rsvp|book|reserve)\b/i, weight: 10, label: 'action-required verb' },
  { re: /\b(pay|payment|bill|invoice|fee)\b/i, weight: 9, label: 'payment language' },
  { re: /\b(today|tonight|tomorrow)\b/i, weight: 8, label: 'near-term time word' },
]

export function scoreUrgency(text: string, dates: ExtractedDate[], now: number = Date.now()): UrgencyInfo {
  const signals: string[] = []
  let score = 0

  for (const s of SIGNALS) {
    if (s.re.test(text)) {
      score += s.weight
      signals.push(s.label)
    }
  }

  const nearest = nearestFutureDateMs(dates)
  if (nearest !== null) {
    const days = (nearest - now) / 86_400_000
    if (days <= 1) {
      score += 34
      signals.push('detected date within 24 hours')
    } else if (days <= 3) {
      score += 22
      signals.push(`detected date in ${Math.ceil(days)} days`)
    } else if (days <= 7) {
      score += 12
      signals.push(`detected date in ${Math.ceil(days)} days`)
    } else if (days <= 30) {
      score += 5
      signals.push(`detected date in ${Math.ceil(days)} days`)
    }
  }

  score = Math.min(100, score)

  const level = score >= 55 ? 'high' : score >= 28 ? 'medium' : score > 0 ? 'low' : 'none'

  // confidence: strong when multiple signals agree, weaker when a lone weak cue
  const strongCount = signals.filter((s) => /deadline|due|forget|urgent|24 hours|days/.test(s)).length
  const confidence =
    strongCount >= 2 ? 'high' : strongCount === 1 ? 'medium' : signals.length > 0 ? 'low' : 'low'

  return { level, score, signals, confidence }
}
