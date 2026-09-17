'use client'

/**
 * Voice note recorder — records locally (MediaRecorder), saves instantly.
 * Transcription happens later in the background IF the voice pack is
 * installed; the note is never blocked on it.
 */
import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { createFragment } from '@/lib/capture'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

export function VoiceRecorder({ voicePackReady }: { voicePackReady: boolean }) {
  const { recorderOpen, setRecorderOpen } = useUI()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(Array(28).fill(2))
  const [saving, setSaving] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const cancelRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rafRef = useRef<number | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    return () => {
      stopEverything()
    }
  }, [])

  function stopEverything() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch { /* already stopped */ }
    }
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      recorderRef.current = rec
      chunksRef.current = []
      cancelRef.current = false
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = onStopped
      rec.start(500)
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)

      // live level meter
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128))
        const level = Math.min(40, 2 + (peak / 128) * 38)
        setLevels((prev) => [...prev.slice(1), level])
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch (e) {
      toast({
        title: 'Microphone unavailable',
        description: 'Grant microphone permission to record voice notes.',
        variant: 'destructive',
      })
      console.warn('[recall] mic failed', (e as Error)?.message)
    }
  }

  function stopAndSave() {
    cancelRef.current = false
    recorderRef.current?.stop()
  }

  function stopAndDiscard() {
    cancelRef.current = true
    recorderRef.current?.stop()
  }

  async function onStopped() {
    const cancelled = cancelRef.current
    stopEverything()
    setRecording(false)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setLevels(Array(28).fill(2))
    if (cancelled || !chunksRef.current.length) return
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'audio/webm' })
    if (blob.size < 800) return
    setSaving(true)
    try {
      await createFragment({ blob, fileName: `voice-note-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, mimeType: blob.type, origin: 'recorder' })
      toast({
        description: voicePackReady
          ? 'Voice note saved — transcribing in the background'
          : 'Voice note saved. Install the Voice pack (Settings) to transcribe it.',
      })
      setRecorderOpen(false)
    } catch (e) {
      toast({ title: 'Could not save recording', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={recorderOpen} onOpenChange={(open) => {
      if (!open && recording) stopAndDiscard()
      setRecorderOpen(open)
    }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mic className="h-4 w-4" /> Voice note</DialogTitle>
          <DialogDescription>
            Saved instantly to this device. {voicePackReady ? 'Transcription runs in the background.' : 'Transcription needs the Voice pack (Settings).'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex h-28 flex-col items-center justify-center gap-4 py-2">
          <div className="flex h-14 items-center gap-1" aria-hidden="true">
            {levels.map((h, i) => (
              <span
                key={i}
                className={cn('w-1 rounded-full bg-primary/70 transition-[height] duration-75', !recording && 'bg-muted-foreground/30')}
                style={{ height: `${Math.max(3, h)}px` }}
              />
            ))}
          </div>
          <div className="font-mono text-lg tabular-nums" role="timer">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </div>
        </div>
        <div className="flex items-center justify-center gap-3">
          {!recording ? (
            <Button size="lg" className="h-12 w-12 rounded-full p-0" onClick={start} aria-label="Start recording">
              <Mic className="h-5 w-5" />
            </Button>
          ) : (
            <>
              <Button variant="outline" size="icon" className="h-11 w-11 rounded-full" onClick={stopAndDiscard} aria-label="Discard recording">
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button size="lg" className="h-14 w-14 rounded-full p-0 animate-pulse" onClick={stopAndSave} aria-label="Stop and save">
                <Square className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
        {saving && <p className="text-center text-xs text-muted-foreground">saving…</p>}
      </DialogContent>
    </Dialog>
  )
}
