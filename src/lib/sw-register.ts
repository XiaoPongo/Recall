'use client'

/**
 * Service worker registration + PWA glue.
 *
 * CAPACITOR NOTE: this module (and manifest.json's share_target) is the only
 * place assuming a browser runtime. When wrapping natively, replace the SW
 * with Capacitor's local server statics + App Listener plugin for share
 * intents; the app logic itself is framework-standard web code.
 */

export function registerSW(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  // Dev servers reuse stable chunk names across recompiles, so an installed
  // SW (cache-first on /_next/static) would serve stale code forever.
  // Offline mode is a property of the production build — verify it there.
  if (process.env.NODE_ENV !== 'production') return
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    // SW requires a secure context; the app still runs without it (no offline caching)
    console.info('[recall] skipping SW registration (insecure context)')
    return
  }
  const register = () => {
    navigator.serviceWorker
      // relative paths — works at the root AND under a GitHub Pages subpath
      .register('sw.js', { scope: './' })
      .then(async (reg) => {
        // check for updates periodically while open
        setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000)
      })
      .catch((e) => console.warn('[recall] SW registration failed:', (e as Error)?.message))
  }

  if (document.readyState === 'complete') {
    register()
  } else {
    window.addEventListener('load', register)
  }
}

export function objectUrlFor(blob: Blob): string {
  return URL.createObjectURL(blob)
}
