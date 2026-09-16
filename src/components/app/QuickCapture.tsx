'use client'

/**
 * Zero-friction capture: paste, type, drop images, or record.
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
          origin: file.type.startsWith('image/') ? 'upload' : 'upload',
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

  return (
    <div
      className={cn(
        'rounded-2xl border bg-card p-3 shadow-sm transition-colors',
        dragOver && 'border-primary/60 ring-2 ring-primary/20'
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
        placeholder="Type or paste anything — a thought, a link, an address… (⌘↵ to save)"
        className="min-h-[64px] resize-none border-0 p-1.5 text-sm shadow-none focus-visible:ring-0"
        aria-label="Quick capture"
      />
      <div className="flex items-center gap-1 pt-1">
        <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && saveFiles(e.target.files)} />
        <input ref={pdfInput} type="file" accept="application/pdf,audio/*" multiple hidden onChange={(e) => e.target.files && saveFiles(e.target.files)} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => imageInput.current?.click()} aria-label="Add photo or screenshot">
              <ImagePlus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Photo / screenshot</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => pdfInput.current?.click()} aria-label="Add PDF or audio file">
              <Paperclip className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>PDF / audio file</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setRecorderOpen(true)} aria-label="Record voice note">
              <Mic className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Voice note</TooltipContent>
        </Tooltip>
        <span className="hidden items-center gap-1 pl-1 text-[11px] text-muted-foreground sm:flex">
          <FileText className="h-3 w-3" /> drop files anywhere here
        </span>
        <Button
          size="icon"
          className="ml-auto h-9 w-9 rounded-xl"
          onClick={save}
          disabled={!text.trim() || saving}
          aria-label="Save fragment"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
