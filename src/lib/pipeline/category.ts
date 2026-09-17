/**
 * Lightweight category inference — always with confidence, never as fact.
 */
import type { CategoryInfo, ExtractedDate } from '../types'

const MEETING = /\b(meeting|standup|sync|1:1|call|zoom|google meet|teams|hangout|interview|appointment|doctor|dentist|flight|train)\b/i
const DEADLINE = /\b(deadline|due|submit|hand in|deliver|final)\b/i
const TASK = /\b(todo|to-do|need to|remember to|should|must|don'?t forget)\b/i
const PURCHASE = /\b(buy|price|order|cart|checkout|discount|deal|shipping)\b/i
const IDEA = /\b(idea|what if|maybe|concept|brainstorm)\b/i

export function inferCategory(text: string, dates: ExtractedDate[]): CategoryInfo | undefined {
  const hasDate = dates.length > 0
  if (MEETING.test(text) && hasDate) return { label: 'meeting', confidence: 'high' }
  if (MEETING.test(text)) return { label: 'meeting', confidence: 'medium' }
  if (DEADLINE.test(text) && hasDate) return { label: 'deadline', confidence: 'high' }
  if (DEADLINE.test(text)) return { label: 'deadline', confidence: 'medium' }
  if (TASK.test(text)) return { label: 'task', confidence: 'medium' }
  if (PURCHASE.test(text)) return { label: 'purchase', confidence: 'medium' }
  if (IDEA.test(text)) return { label: 'idea', confidence: 'low' }
  return undefined
}
