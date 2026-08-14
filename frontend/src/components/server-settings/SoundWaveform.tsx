'use client'

import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'

const BAR_COUNT = 72

function sampleWaveform(buffer: AudioBuffer): number[] {
  const data = buffer.getChannelData(0)
  const block = Math.max(1, Math.floor(data.length / BAR_COUNT))
  const samples = Array.from({ length: BAR_COUNT }, (_, index) => {
    let peak = 0
    const start = index * block
    const end = Math.min(data.length, start + block)
    for (let cursor = start; cursor < end; cursor += 1) peak = Math.max(peak, Math.abs(data[cursor]))
    return peak
  })
  const max = Math.max(...samples, 0.01)
  return samples.map((value) => Math.max(0.08, value / max))
}

export function SoundWaveform({ file, onDuration }: { file: File; onDuration: (durationMs: number) => void }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [url] = useState(() => URL.createObjectURL(file))
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.12))
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    let active = true
    void file.arrayBuffer().then(async (bytes) => {
      const context = new AudioContext()
      try {
        const decoded = await context.decodeAudioData(bytes.slice(0))
        if (!active) return
        setBars(sampleWaveform(decoded))
        setDuration(decoded.duration)
        onDuration(Math.round(decoded.duration * 1000))
      } finally {
        await context.close().catch(() => undefined)
      }
    }).catch(() => onDuration(0))
    return () => {
      active = false
      URL.revokeObjectURL(url)
    }
  }, [file, onDuration, url])

  const toggle = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) await audio.play()
    else audio.pause()
  }

  return (
    <div className="flex h-24 items-center gap-3 rounded-lg border border-border bg-canvas-deep px-3">
      <audio
        ref={audioRef}
        src={url}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={(event) => setProgress(event.currentTarget.duration ? event.currentTarget.currentTime / event.currentTarget.duration : 0)}
      />
      <button type="button" onClick={() => void toggle()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-white hover:bg-surface-hover" aria-label={playing ? 'Приостановить предпросмотр' : 'Воспроизвести предпросмотр'}>
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
      </button>
      <div className="relative flex h-14 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-label="Форма звуковой волны">
        {bars.map((height, index) => (
          <span
            key={index}
            className={`w-full min-w-[1px] rounded-full ${index / bars.length <= progress ? 'bg-primary' : 'bg-text-muted'}`}
            style={{ height: `${Math.round(8 + height * 42)}px` }}
          />
        ))}
      </div>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-amber-300">{duration.toFixed(2)}s</span>
    </div>
  )
}
