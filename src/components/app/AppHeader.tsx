'use client'

import { Download, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LocalBadge, RippleMark } from './bits'
import { useTheme } from '@/lib/theme'

export function AppHeader({ installable, onInstall }: { installable: boolean; onInstall: () => void }) {
  const { pref, setPref } = useTheme()

  // cycle: system → light → dark → system
  const next = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
  const ThemeIcon = pref === 'dark' ? Moon : pref === 'light' ? Sun : Monitor
  const themeLabel = pref === 'dark' ? 'Dark theme' : pref === 'light' ? 'Light theme' : 'Theme: follow system'

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2.5 px-3 sm:px-5">
        <RippleMark className="h-7 w-7 rounded-lg shadow-sm shadow-primary/25" />
        <span className="font-display text-[17px] font-semibold tracking-tight">Recall</span>
        <div className="hidden sm:block">
          <LocalBadge />
        </div>
        <div className="sm:hidden">
          <LocalBadge compact />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {installable && (
            <Button variant="outline" size="sm" onClick={onInstall} className="h-9 gap-1.5 rounded-full text-xs">
              <Download className="h-3.5 w-3.5" /> Install
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full"
            onClick={() => setPref(next)}
            aria-label={themeLabel}
            title={`${themeLabel} — tap to change`}
          >
            <ThemeIcon className="h-[18px] w-[18px]" />
          </Button>
        </div>
      </div>
    </header>
  )
}
