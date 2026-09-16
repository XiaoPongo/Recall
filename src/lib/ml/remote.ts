/**
 * Remote ESM module loader.
 *
 * The intelligence packs (transformers.js, tesseract.js, pdf.js) are fetched
 * from CDN on the FIRST-RUN SETUP ONLY, then cached by the service worker for
 * offline use. We must prevent the bundler from trying to statically resolve
 * these URLs, hence webpackIgnore/turbopackIgnore + a <script type=module>
 * fallback that works under any bundler.
 */

type AnyModule = Record<string, unknown>

const loaded = new Map<string, AnyModule>()

async function viaDynamicImport(url: string): Promise<AnyModule> {
  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)
  return (mod?.default && Object.keys(mod).length === 1 && typeof mod.default === 'object'
    ? (mod.default as AnyModule)
    : (mod as AnyModule)) as AnyModule
}

async function viaScriptTag(url: string, globalName: string): Promise<AnyModule> {
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.type = 'module'
    s.textContent = `import * as m from ${JSON.stringify(url)}; window.${globalName} = m; window.dispatchEvent(new Event('${globalName}:ready'))`
    const timer = setTimeout(() => reject(new Error('timeout loading ' + url)), 120_000)
    const ready = () => {
      clearTimeout(timer)
      resolve()
    }
    window.addEventListener(`${globalName}:ready`, ready, { once: true })
    window.addEventListener('error', () => { clearTimeout(timer); reject(new Error('load error ' + url)) }, { once: true })
    document.head.appendChild(s)
  })
  const w = window as unknown as Record<string, AnyModule>
  if (!w[globalName]) throw new Error('module did not attach: ' + url)
  return w[globalName]
}

export async function remoteImport(url: string, globalName: string): Promise<AnyModule> {
  const key = url
  const cached = loaded.get(key)
  if (cached) return cached
  let mod: AnyModule
  try {
    mod = await viaDynamicImport(url)
  } catch (e) {
    console.warn('[recall] dynamic import failed, falling back to script tag:', (e as Error)?.message)
    mod = await viaScriptTag(url, globalName)
  }
  loaded.set(key, mod)
  return mod
}
