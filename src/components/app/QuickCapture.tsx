'use client'

/**
 * Zero-friction capture — the most important element on screen.
 * Visually dominant: a warm coral hero card that says "dump it here".
 * No title. No folder. No tags. Just save.
 */
import { useRef, useState } from 'react'
import { ArrowUp, FileText, ImagePlus, Loader2, Mic, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { createFragment } from '@/lib/capture'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

export function QuickCapture() {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const { setRecorderOpen } = useUI()
  const { toast } = useToast()

  async function save() {
    const t = text.trim()
    if (!t || saving) return
    setSaving(true)
    try {
      await createFragment({ text: t, origin: 'manual' })
      setText('')
      toast({ description: 'Saved to your memory pool' })
    } catch (e) {
      toast({ title: 'Could not save', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function saveFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (!list.length) return
    setSaving(true)
    try {
      for (const file of list) {
        await createFragment({
          blob: file,
          fileName: file.name,
          mimeType: file.type,
          origin: 'upload',
        })
      }
      toast({ description: `Saved ${list.length} ${list.length === 1 ? 'fragment' : 'fragments'}` })
    } catch (e) {
      toast({ title: 'Could not save file', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files ?? [])
    if (files.length) {
      e.preventDefault()
      await saveFiles(files)
    }
  }

  const attachBtn =
    'h-10 w-10 rounded-full border border-border/60 bg-card/70 text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-accent-foreground transition-colors'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/12 via-card to-primary/5 p-4 shadow-lg shadow-primary/10 transition-all',
        dragOver && 'scale-[1.01] border-primary/60 ring-2 ring-primary/25'
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDragOver(false)
        await saveFiles(e.dataTransfer.files)
      }}
    >
      {/* soft coral glow decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 -left-10 h-36 w-36 rounded-full bg-primary/10 blur-3xl"
      />

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void save()
          }
        }}
        placeholder="What's on your mind? A thought, a link, a reminder — just dump it here…"
        aria-label="Quick capture"
        className="min-h-[76px] resize-none border-0 bg-transparent p-1.5 text-[15px] leading-relaxed text-foreground shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
      />

      <div className="relative flex items-center gap-1.5 pt-2">
        <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && saveFiles(e.target.files)} />
        <input ref={pdfInput} type="file" accept="application/pdf,audio/*" multiple hidden onChange={(e) => e.target.files && saveFiles(e.target.files)} />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className={attachBtn} onClick={() => imageInput.current?.click()} aria-label="Add photo or screenshot">
              <ImagePlus className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Photo / screenshot</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className={attachBtn} onClick={() => pdfInput.current?.click()} aria-label="Add PDF or audio file">
              <Paperclip className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>PDF / audio file</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className={attachBtn} onClick={() => setRecorderOpen(true)} aria-label="Record voice note">
              <Mic className="h-[18px] w-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Voice note</TooltipContent>
        </Tooltip>

        <span className="ml-1 hidden items-center gap-1 text-[11px] text-muted-foreground/80 sm:flex">
          <FileText className="h-3 w-3" /> drop or paste files
        </span>
        <span className="ml-auto hidden text-[11px] text-muted-foreground/60 sm:flex" aria-hidden="true">
          ⌘↵
        </span>

        <Button
          size="lg"
          className="h-11 rounded-full px-5 font-semibold shadow-md shadow-primary/25"
          onClick={save}
          disabled={!text.trim() || saving}
          aria-label="Save fragment"
        >
          {saving ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
          Save
        </Button>
      </div>
    </div>
  )
}
