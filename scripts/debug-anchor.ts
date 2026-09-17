/* Debug the anchor query logic */
import { parseAnchorQuery } from '../src/lib/search/timeparse'
import { cosine, lexicalVector } from '../src/lib/ml/lexical'

const q = 'when I saved the Tokyo stuff'
const anchor = parseAnchorQuery(q)
console.log('anchor:', JSON.stringify(anchor))

// simulate the seeded tokyo fragments
const tokyo1 = 'Tokyo trip planning\nTokyo trip planning — aiming for April, cherry blossom season. Book flights early, prices around $850 round trip. Don\u2019t forget rail pass needs purchase before arrival.'
const tokyo2 = 'https://www.japan-guide.com/e/e2158_tokyo.html\nJapan Guide — Tokyo travel guide, districts, temples, food'
const laptop = 'reddit r/SuggestALaptop — best dev laptop 2026 thread'
const qv = lexicalVector(anchor ?? 'tokyo')

const items = [
  ['tokyo1', tokyo1],
  ['tokyo2', tokyo2],
  ['laptop', laptop],
] as const

for (const [name, text] of items) {
  const fv = lexicalVector(text)
  console.log(name, 'cos =', cosine(qv, fv).toFixed(4))
}
