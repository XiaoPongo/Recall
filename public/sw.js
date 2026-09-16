/*
 * Recall — service worker.
 * - Offline app shell (network-first navigation, cache-first statics)
 * - Runtime caching for intelligence-pack CDN files so models work offline
 * - Web Share Target: receives shared text/links/files from other apps,
 *   persists them into a tiny IndexedDB inbox, redirects into the app.
 *
 * CAPACITOR NOTE: when wrapped natively this file is replaced by Capacitor's
 * static server + plugins (App / LocalNotifications / Filesystem). The
 * share inbox DB contract below is stable and can be reused as-is.
 */
const VERSION = 'v3'
const STATIC_CACHE = `recall-static-${VERSION}`
const MODEL_CACHE = 'recall-models-v1'
const NAV_CACHE = `recall-nav-${VERSION}`

const PRECACHE = ['/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png']

const MODEL_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'tessdata.projectnaptha.com',
  'huggingface.co',
  'hf.co',
  'cas-bridge.xethub.hf.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs-us-1.hf.co',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => (k.startsWith('recall-static-') || k.startsWith('recall-nav-')) && k !== STATIC_CACHE && k !== NAV_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

/* ------------------------------------------------------------------ */
/* fetch handling                                                      */
/* ------------------------------------------------------------------ */

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // CDN model files (transformers/tesseract/pdf.js weights) — cache-first
  if (MODEL_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(cacheFirst(req, MODEL_CACHE))
    return
  }

  if (url.origin !== self.location.origin) return

  // immutable build assets + icons — cache-first
  if (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons') || url.pathname === '/favicon.png' || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirst(req, STATIC_CACHE))
    return
  }

  // navigations — network-first so dev/HMR stays fresh, cached fallback offline
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNav(req))
    return
  }
})

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req, { ignoreVary: true })
  if (hit) return hit
  try {
    const res = await fetch(req)
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone()).catch(() => {})
    }
    return res
  } catch (e) {
    const stale = await cache.match(req, { ignoreVary: true })
    if (stale) return stale
    throw e
  }
}

async function networkFirstNav(req) {
  const cache = await caches.open(NAV_CACHE)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put('/', res.clone()).catch(() => {})
    return res
  } catch (e) {
    const cached = (await cache.match(req)) || (await cache.match('/'))
    if (cached) return cached
    return new Response('<h1>Offline</h1><p>Recall needs one online load to install its offline shell.</p>', {
      headers: { 'Content-Type': 'text/html' },
      status: 503,
    })
  }
}

/* ------------------------------------------------------------------ */
/* share target                                                        */
/* ------------------------------------------------------------------ */

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'POST') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (!(url.searchParams.has('share') || url.pathname === '/share')) return
  event.respondWith(handleShare(req))
})

async function handleShare(req) {
  try {
    const formData = await req.formData()
    const title = str(formData.get('title'))
    const text = str(formData.get('text'))
    const url = str(formData.get('url'))

    let savedAny = false
    for (const value of formData.values()) {
      if (value && typeof value === 'object' && typeof value.size === 'number' && value.size > 0) {
        await saveShare({
          kind: 'file',
          blob: value,
          fileName: value.name || 'shared-file',
          mimeType: value.type || 'application/octet-stream',
          receivedAt: Date.now(),
        })
        savedAny = true
      }
    }
    if (!savedAny && (title || text || url)) {
      await saveShare({ kind: 'text', title, text, url, receivedAt: Date.now() })
    }
  } catch (e) {
    console.error('[sw] share handling failed', e)
  }
  return Response.redirect(new URL('/?from=share', self.location.origin).toString(), 303)
}

function str(v) {
  return typeof v === 'string' ? v : ''
}

/** minimal raw IndexedDB write into the share inbox (Dexie-compatible schema).
 *  Opens WITHOUT a version so it works whether Dexie already created the DB
 *  (at its own higher version) or this is a fresh install. */
function saveShare(item) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('recall-share-inbox')
    open.onupgradeneeded = () => {
      // fresh database — create the store ourselves (matches Dexie '++id')
      if (!open.result.objectStoreNames.contains('pending')) {
        open.result.createObjectStore('pending', { keyPath: 'id', autoIncrement: true })
      }
    }
    open.onsuccess = () => {
      const db = open.result
      try {
        if (!db.objectStoreNames.contains('pending')) {
          db.close()
          return resolve()
        }
        const tx = db.transaction('pending', 'readwrite')
        tx.objectStore('pending').add(item)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      } catch (e) {
        db.close()
        reject(e)
      }
    }
    open.onerror = () => reject(open.error)
  })
}

/* ------------------------------------------------------------------ */
/* notifications (sparse — deadlines only, fired by the app)            */
/* ------------------------------------------------------------------ */

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientList) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) await self.clients.openWindow('/')
    })()
  )
})
