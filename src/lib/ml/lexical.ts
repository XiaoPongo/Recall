/**
 * Built-in lexical embedding engine — zero download, instant.
 * Hashed word unigram/bigram + character trigram vectors with TF weighting.
 * Gives fuzzy-ish matching so the app is never dead in the water; the
 * semantic pack (all-MiniLM-L6-v2) upgrades quality once downloaded.
 */

const STOPWORDS = new Set(
  ('the a an and or of to in on for with is are was were be been being it this that these those i my me mine we our ours you your yours he she it they them their his her as at by from but not no nor so if then than too very can will just about into over after under again further once here there when why how all any both each few more most other some such only own same s t don dont now what which who whom am do does did doing have has had having get got go going im ive dont cant wont thats its were would could should us ok okay etc also')
    .split(' ')
)

export function stemLite(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1)
  return w
}

/** lowercase word tokens with punctuation stripped; keeps urls intact-ish */
export function words(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, (m) => ' ' + m.replace(/[/:._?&=\-~#%]+/g, ' ') + ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
}

export function tokenize(text: string): string[] {
  return words(text)
    .filter((t) => !STOPWORDS.has(t))
    .map(stemLite)
    .filter((t) => t.length >= 2)
}

/** FNV-1a 32-bit hash */
function fnv1a(str: string, seed = 0x811c9dc5): number {
  let h = seed
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const DIM = 640

/** Signed hashing trick: pairs of (index, sign) buckets */
function add(v: Float32Array, key: string, weight: number) {
  const h1 = fnv1a(key)
  const idx = h1 % DIM
  const sign = (fnv1a(key, 0x9e3779b9) & 1) === 0 ? 1 : -1
  v[idx] += sign * weight
}

export function lexicalVector(text: string): Float32Array {
  const v = new Float32Array(DIM)
  const toks = tokenize(text)
  const counts = new Map<string, number>()
  for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1)

  for (const [tok, tf] of counts) {
    const w = 1 + Math.log(tf)
    add(v, 'u:' + tok, w)
    // character trigrams give typo-tolerance and morphological fuzz
    if (tok.length >= 4) {
      const grams = tok.length - 2
      for (let i = 0; i < grams; i++) {
        add(v, 'c:' + tok.slice(i, i + 3), (w * 0.45) / grams)
      }
    }
  }
  // word bigrams — light phrase structure
  for (let i = 0; i + 1 < toks.length; i++) {
    add(v, 'b:' + toks[i] + '_' + toks[i + 1], 1.15)
  }
  // L2 normalize
  let norm = 0
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < DIM; i++) v[i] /= norm
  return v
}

export function cosine(a: Float32Array | undefined | null, b: Float32Array | undefined | null): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

/** Salient terms by simple TF with stopword removal — used for thread titles */
export function salientTerms(texts: string[], max = 5): string[] {
  const df = new Map<string, number>()
  const docs: string[][] = texts.map((t) => Array.from(new Set(tokenize(t))))
  for (const doc of docs) for (const t of doc) df.set(t, (df.get(t) ?? 0) + 1)
  const scored = new Map<string, number>()
  for (const doc of docs) {
    for (const t of doc) {
      if (t.length < 3) continue
      const idf = Math.log((docs.length + 1) / ((df.get(t) ?? 0) + 0.5))
      scored.set(t, (scored.get(t) ?? 0) + idf)
    }
  }
  // prefer terms appearing in more docs first, then idf weight
  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1] || (df.get(b[0]) ?? 0) - (df.get(a[0]) ?? 0))
    .slice(0, max)
    .map(([t]) => t)
}
