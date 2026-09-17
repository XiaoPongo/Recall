'use client'

/**
 * Theme preference — 'system' by default, manual override persisted in
 * localStorage (synchronous, so the inline <head> script in layout.tsx
 * can apply it before first paint to avoid a flash).
 */

import { useCallback, useSyncExternalStore } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'recall-theme'

export function readThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'system'
  const v = window.localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function applyThemePref(p: ThemePref): void {
  if (typeof window === 'undefined') return
  const dark =
    p === 'dark' || (p === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const el = document.documentElement
  el.classList.toggle('dark', dark)
  el.style.colorScheme = dark ? 'dark' : 'light'
}

export function setThemePref(p: ThemePref): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, p)
  applyThemePref(p)
}

/* ------------------------------------------------------------------ */
/* store plumbing — no setState-in-effect, no hydration mismatch        */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // live-follow the OS while in 'system' mode
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (readThemePref() === 'system') applyThemePref('system')
    cb()
  }
  mq.addEventListener('change', onChange)
  return () => {
    listeners.delete(cb)
    mq.removeEventListener('change', onChange)
  }
}

function getSnapshot(): ThemePref {
  return readThemePref()
}

function getServerSnapshot(): ThemePref {
  return 'system'
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const setPref = useCallback((p: ThemePref) => {
    setThemePref(p)
    notify()
  }, [])
  return { pref, setPref }
}
