/**
 * Decode an audio Blob to 16 kHz mono PCM for the local Whisper model.
 * Runs fully on-device via WebAudio (OfflineAudioContext when needed).
 */

export async function decodeAudio16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  let decoded: AudioBuffer
  try {
    const ctx = new AudioContext({ sampleRate: 16000 })
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
    } finally {
      void ctx.close()
    }
  } catch {
    const ctx = new OfflineAudioContext(1, 1, 48000)
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
  }

  // mono mixdown
  let mono: Float32Array
  if (decoded.numberOfChannels > 1) {
    const a = decoded.getChannelData(0)
    const b = decoded.getChannelData(1)
    mono = new Float32Array(a.length)
    for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2
  } else {
    mono = new Float32Array(decoded.getChannelData(0))
  }

  // resample to 16 kHz if the browser did not honor the context rate
  const target = 16000
  if (Math.abs(decoded.sampleRate - target) > 1) {
    const ratio = decoded.sampleRate / target
    const outLen = Math.max(1, Math.floor(mono.length / ratio))
    const out = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio
      const i0 = Math.floor(pos)
      const i1 = Math.min(mono.length - 1, i0 + 1)
      const frac = pos - i0
      out[i] = mono[i0] * (1 - frac) + mono[i1] * frac
    }
    return out
  }
  return mono
}
