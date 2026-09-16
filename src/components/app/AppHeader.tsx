'use client'

import { Download, Menu, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LocalBadge, RippleMark } from './bits'
import { useUI } from '@/lib/store'

export function AppHeader({ installable, onInstall }: { installable: boolean; onInstall: () => void }) {
  const setDrawerOpen = useUI((s) => s.setDrawerOpen)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:px-5">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open type drawer"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2.5">
          <RippleMark className="h-7 w-7 rounded-md shadow-sm" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">Recall</div>
          </div>
        </div>
        <div className="ml-1 hidden sm:block">
          <LocalBadge />
        </div>
        <div className="sm:hidden">
          <LocalBadge compact />
        </div>
        <div className="ml-auto flex items-center gap-1">
          {installable && (
            <Button variant="outline" size="sm" onClick={onInstall} className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" /> Install
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <Settings2 className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  )
}
