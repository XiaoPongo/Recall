/**
 * Optional sample data (clearly labeled, one click to add, fully deletable).
 * Runs the REAL local analyzers (dates, urgency, category, embeddings) so
 * what you see is exactly what the pipeline would produce.
 */
import { db } from './db'
import type { Fragment, FragmentType, Thread } from './types'
import { extractDates } from './pipeline/dates'
import { scoreUrgency } from './pipeline/urgency'
import { inferCategory } from './pipeline/category'
import { lexicalVector } from './ml/lexical'
import { recomputeThreadMeta } from './pipeline/threads'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

interface SeedSpec {
  type: FragmentType
  rawContent: string
  textContent?: string
  createdAt: number
  threadKey?: string
  origin?: string
  /** which generated screenshot to use for image fragments */
  image?: 'price' | 'comparison'
}

async function canvasImage(draw: (ctx: CanvasRenderingContext2D) => void): Promise<{ blob: Blob; thumb: string }> {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 400
  const ctx = c.getContext('2d')!
  draw(ctx)
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'))
  const t = document.createElement('canvas')
  t.width = 320
  t.height = 200
  t.getContext('2d')!.drawImage(c, 0, 0, 320, 200)
  return { blob, thumb: t.toDataURL('image/jpeg', 0.72) }
}

function priceScreenshot(): Promise<{ blob: Blob; thumb: string }> {
  return canvasImage((ctx) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 640, 400)
    ctx.fillStyle = '#f3f4f6'
    ctx.fillRect(0, 0, 640, 64)
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 24px sans-serif'
    ctx.fillText('Zenbook 14 OLED — Deal', 24, 40)
    ctx.font = 'bold 42px sans-serif'
    ctx.fillStyle = '#b91c1c'
    ctx.fillText('$1,099.00', 24, 150)
    ctx.font = '20px sans-serif'
    ctx.fillStyle = '#6b7280'
    ctx.fillText('was $1,299.00   −16%', 24, 185)
    ctx.fillStyle = '#111827'
    ctx.fillText('Asus Zenbook 14" · Ryzen 7 · 16GB · 512GB', 24, 240)
    ctx.fillText('In stock — ships tomorrow', 24, 272)
    ctx.fillStyle = '#d97706'
    ctx.fillRect(24, 310, 160, 44)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 20px sans-serif'
    ctx.fillText('Add to cart', 44, 339)
  })
}

function comparisonScreenshot(): Promise<{ blob: Blob; thumb: string }> {
  return canvasImage((ctx) => {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 640, 400)
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText('Laptop comparison — final', 24, 36)
    const rows = [
      ['', 'ThinkPad T14s', 'Zenbook 14'],
      ['Keyboard', '★★★★★', '★★★☆☆'],
      ['Screen', '★★★☆☆', '★★★★★'],
      ['Battery', '9h', '13h'],
      ['Price', '$1,399', '$1,099'],
    ]
    rows.forEach((row, r) => {
      const y = 90 + r * 52
      if (r === 0) {
        ctx.fillStyle = '#f3f4f6'
        ctx.fillRect(16, y - 26, 608, 40)
      }
      ctx.fillStyle = r === 0 ? '#111827' : '#374151'
      ctx.font = r === 0 ? 'bold 18px sans-serif' : '18px sans-serif'
      row.forEach((cell, ci) => ctx.fillText(cell, 24 + ci * 200, y))
    })
  })
}

/** minimal valid single-page PDF with real extractable text */
function makePdf(lines: string[]): Blob {
  let content = ''
  lines.forEach((l, i) => {
    content += `BT /F1 ${i === 0 ? 15 : 11} Tf 50 ${742 - i * 26} Td (${l.replace(/[()\\]/g, '')}) Tj ET\n`
  })
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  const streamObj = `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const o of objs) {
    offsets.push(pdf.length)
    pdf += o
  }
  offsets.push(pdf.length)
  pdf += streamObj
  const xref = pdf.length
  pdf += 'xref\n0 6\n0000000000 65535 f \n'
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  const bytes = new Uint8Array(pdf.length)
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff
  return new Blob([bytes], { type: 'application/pdf' })
}

export async function seedSampleData(): Promise<number> {
  if ((await db.fragments.count()) > 0) return 0
  const now = Date.now()

  const specs: SeedSpec[] = [
    // ---- laptop research thread (past 5 days) ----
    { type: 'link', rawContent: 'https://www.reddit.com/r/SuggestALaptop/comments/best_dev_laptop/', textContent: 'reddit r/SuggestALaptop — best dev laptop 2026 thread', createdAt: now - 5 * DAY - 3 * HOUR, threadKey: 'laptop' },
    { type: 'text', rawContent: 'Need a new laptop for work — mainly coding plus light video editing. Budget 1200-1500. Don\u2019t forget to check battery life reviews before deciding.', createdAt: now - 5 * DAY - 2.4 * HOUR, threadKey: 'laptop' },
    { type: 'link', rawContent: 'https://www.notebookcheck.net/Lenovo-ThinkPad-T14s-G6-review.918432.0.html', textContent: 'Notebookcheck — ThinkPad T14s G6 review: great keyboard, matte screen', createdAt: now - 4 * DAY - 2 * HOUR, threadKey: 'laptop' },
    { type: 'image', rawContent: 'zenbook-price.png', textContent: 'Zenbook 14 OLED deal — $1,099.00 was $1,299.00', createdAt: now - 3 * DAY - 5 * HOUR, threadKey: 'laptop', image: 'price' },
    { type: 'image', rawContent: 'laptop-comparison.png', textContent: 'Laptop comparison final — keyboard thinkpad, screen zenbook, battery 9h vs 13h, price 1399 vs 1099', createdAt: now - 3 * DAY - 4.9 * HOUR, threadKey: 'laptop', image: 'comparison' },
    { type: 'link', rawContent: 'https://www.youtube.com/watch?v=zenbook-vs-thinkpad-2026', textContent: 'YouTube — Zenbook 14 vs ThinkPad T14s 2026 comparison video', createdAt: now - 2 * DAY - 6 * HOUR, threadKey: 'laptop' },
    { type: 'text', rawContent: 'Comparison notes: ThinkPad better keyboard, Zenbook better screen and battery. Will decide by next week and order before the sale ends.', createdAt: now - 1 * DAY - 4 * HOUR, threadKey: 'laptop' },
    // duplicate of the reddit link saved again recently
    { type: 'link', rawContent: 'https://www.reddit.com/r/SuggestALaptop/comments/best_dev_laptop/', textContent: 'reddit r/SuggestALaptop — best dev laptop 2026 thread', createdAt: now - 1 * HOUR },
    // ---- Tokyo trip thread (~2 months ago) ----
    { type: 'link', rawContent: 'https://www.japan-guide.com/e/e2158_tokyo.html', textContent: 'Japan Guide — Tokyo travel guide, districts, temples, food', createdAt: now - 60 * DAY - 4 * HOUR, threadKey: 'tokyo' },
    { type: 'text', rawContent: 'Tokyo trip planning — aiming for April, cherry blossom season. Book flights early, prices around $850 round trip. Don\u2019t forget rail pass needs purchase before arrival.', createdAt: now - 60 * DAY - 3.6 * HOUR, threadKey: 'tokyo' },
    { type: 'link', rawContent: 'https://www.booking.com/hotel/jp/park-hyatt-tokyo.html', textContent: 'Booking — Park Hyatt Tokyo, Shinjuku, from $390/night', createdAt: now - 59 * DAY - 11 * HOUR, threadKey: 'tokyo' },
    { type: 'text', rawContent: 'Neighborhoods shortlist: Shinjuku for food and nightlife, Asakusa for temples, Shimokitazawa for vintage shops and coffee.', createdAt: now - 58 * DAY - 13 * HOUR, threadKey: 'tokyo' },
    // ---- tax thread (~12 days ago) ----
    { type: 'pdf', rawContent: 'property-tax-2026.pdf', textContent: 'CITY TAX OFFICE — PROPERTY TAX 2026\nSecond installment due Friday, September 26.\nPay online at the tax portal or by bank transfer.\nLate payments incur a 1.5% monthly penalty.\nReference: PT-2026-00871', createdAt: now - 12 * DAY - 7 * HOUR, threadKey: 'tax' },
    { type: 'text', rawContent: 'Property tax second installment — due Friday. Pay online at the tax portal, account number is on the PDF. Deadline!', createdAt: now - 12 * DAY - 6.8 * HOUR, threadKey: 'tax' },
    { type: 'text', rawContent: 'Don\u2019t forget: the tax portal password is in the password manager under \u201Ccity-tax\u201D.', createdAt: now - 11 * DAY - 15 * HOUR, threadKey: 'tax' },
    // ---- standalone time-sensitive items ----
    { type: 'text', rawContent: 'Dentist appointment tomorrow at 3:30pm — Dr. Meyer, remember to bring the insurance card.', createdAt: now - 1 * DAY },
    { type: 'text', rawContent: 'Standup moved to 10am Friday — sprint planning follows right after.', createdAt: now - 6 * HOUR },
    { type: 'text', rawContent: 'Renew passport — expires in March, needs 6+ months validity for Japan trip.', createdAt: now - 20 * DAY },
    { type: 'link', rawContent: 'https://news.ycombinator.com/item?id=49102384', textContent: 'Hacker News — Show HN: Offline-first apps and local-first software discussion', createdAt: now - 2 * DAY - 8 * HOUR },
  ]

  const threadIds = new Map<string, string>([
    ['laptop', crypto.randomUUID()],
    ['tokyo', crypto.randomUUID()],
    ['tax', crypto.randomUUID()],
  ])

  const created: Fragment[] = []
  for (const spec of specs) {
    const text = `${spec.rawContent}\n${spec.textContent ?? ''}`
    const dates = extractDates(text, new Date(spec.createdAt))
    const f: Fragment = {
      id: crypto.randomUUID(),
      type: spec.type,
      createdAt: spec.createdAt,
      rawContent: spec.rawContent,
      textContent: spec.textContent ?? spec.rawContent,
      origin: 'seed',
      originNote: 'sample data',
      processing: { status: 'ready', steps: {} },
      extracted: {
        dates,
        urgency: scoreUrgency(text, dates, spec.createdAt),
        category: inferCategory(text, dates),
      },
      threadId: spec.threadKey ? threadIds.get(spec.threadKey) : undefined,
    }
    const stepList: Array<keyof Fragment['processing']['steps']> =
      spec.type === 'image'
        ? ['ocr', 'dates', 'urgency', 'category', 'embed', 'dedupe', 'thread']
        : spec.type === 'pdf'
          ? ['extract-pdf', 'dates', 'urgency', 'category', 'embed', 'dedupe', 'thread']
          : ['dates', 'urgency', 'category', 'embed', 'dedupe', 'thread']
    for (const s of stepList) f.processing.steps[s] = 'done'
    f.lexicalEmbedding = { model: 'lexical', dim: 640, vector: lexicalVector(text) }

    if (spec.type === 'image') {
      const kind = (spec as SeedSpec & { image?: string }).image
      const img = kind === 'comparison' ? await comparisonScreenshot() : await priceScreenshot()
      f.blob = img.blob
      f.thumb = img.thumb
      f.mimeType = 'image/png'
    }
    if (spec.type === 'pdf') {
      f.blob = makePdf([
        'CITY TAX OFFICE — PROPERTY TAX 2026',
        'Second installment due Friday, September 26.',
        'Pay online at the tax portal or by bank transfer.',
        'Late payments incur a 1.5% monthly penalty.',
        'Reference: PT-2026-00871',
      ])
      f.mimeType = 'application/pdf'
    }
    created.push(f)
  }

  // mark the duplicate (same reddit link saved twice)
  const dup = created.find((f) => f.type === 'link' && f.createdAt > now - 2 * HOUR && f.rawContent.includes('reddit'))
  const orig = dup && created.find((f) => f.id !== dup.id && f.rawContent === dup.rawContent)
  if (dup && orig) {
    dup.duplicateOf = { id: orig.id, confidence: 'high' }
  }

  // fragments first — thread computation reads them from the DB
  await db.fragments.bulkPut(created)

  // then threads (recompute reads members from the DB)
  const now2 = Date.now()
  for (const [key, id] of threadIds) {
    void key
    const thread: Thread = {
      id,
      createdAt: Math.min(...created.filter((f) => f.threadId === id).map((m) => m.createdAt)),
      updatedAt: now2,
      terms: [],
      title: '',
      summary: '',
      confidence: 'low',
      cohesion: 0,
    }
    await db.threads.put(thread)
    await recomputeThreadMeta(id)
  }
  return created.length
}
