'use client'

/**
 * UI state (view routing, filters, selection). Data itself lives in
 * IndexedDB and flows into components via Dexie useLiveQuery.
 */
import { create } from 'zustand'
import type { SearchHit } from './types'

export type MainView = 'inbox' | 'today' | 'threads' | 'search'
export type Lens = 'all' | 'text' | 'link' | 'image' | 'pdf' | 'audio' | 'deadlines' | 'meetings' | 'unprocessed'

interface UIState {
  view: MainView
  lens: Lens
  query: string
  settingsOpen: boolean
  selectedFragmentId: string | null
  selectedThreadId: string | null
  searchHits: SearchHit[] | null
  searching: boolean
  searchTimeLabel?: string
  recorderOpen: boolean
  /** increments to ask the SearchBar to grab focus (bottom-nav Search tab) */
  searchFocusToken: number
  setView: (v: MainView) => void
  setLens: (l: Lens) => void
  setQuery: (q: string) => void
  setSettingsOpen: (open: boolean) => void
  openFragment: (id: string | null) => void
  openThread: (id: string | null) => void
  setSearch: (hits: SearchHit[] | null, timeLabel?: string) => void
  setSearching: (b: boolean) => void
  setRecorderOpen: (b: boolean) => void
  focusSearch: () => void
}

export const useUI = create<UIState>((set) => ({
  view: 'inbox',
  lens: 'all',
  query: '',
  settingsOpen: false,
  selectedFragmentId: null,
  selectedThreadId: null,
  searchHits: null,
  searching: false,
  recorderOpen: false,
  searchFocusToken: 0,
  setView: (view) => set({ view }),
  setLens: (lens) => set({ lens, view: 'inbox' }),
  setQuery: (query) => set({ query, view: query.trim() ? 'search' : 'inbox' }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  openFragment: (selectedFragmentId) => set({ selectedFragmentId }),
  openThread: (selectedThreadId) => set({ selectedThreadId }),
  setSearch: (searchHits, searchTimeLabel) => set({ searchHits, searchTimeLabel }),
  setSearching: (searching) => set({ searching }),
  setRecorderOpen: (recorderOpen) => set({ recorderOpen }),
  focusSearch: () => set((s) => ({ searchFocusToken: s.searchFocusToken + 1, view: 'search' })),
}))
