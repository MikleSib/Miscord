'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader, Music2, Volume2, VolumeX } from 'lucide-react'
import expressionService from '../../services/expressionService'
import { getSoundboardSettings, setSoundboardSettings } from '../../services/soundboardSettings'
import { playSoundboardUrl } from '../../services/voice/soundboardPlayback'
import type { ServerExpression } from '../../types'
import { useCapabilities } from '../../features/capabilities/capabilities'

export function SoundboardPanel({ serverId, channelId, disabled }: { serverId: number; channelId: number; disabled?: boolean }) {
  const capabilities = useCapabilities()
  const [open, setOpen] = useState(false)
  const [sounds, setSounds] = useState<ServerExpression[]>([])
  const [playing, setPlaying] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(getSoundboardSettings)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || !capabilities.soundboard) return
    void expressionService.list(serverId, 'sound').then(setSounds).catch(() => setError('Не удалось загрузить звуковую панель.'))
    const pointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', pointer); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', pointer); document.removeEventListener('keydown', key) }
  }, [capabilities.soundboard, open, serverId])
  const update = (next: typeof settings) => { setSettings(next); setSoundboardSettings(next) }
  const play = async (sound: ServerExpression) => {
    setPlaying(sound.id); setError('')
    try {
      const playback = await expressionService.soundboardTicket(channelId, sound.id)
      await playSoundboardUrl(playback.sound.file_url, playback.ticket)
    } catch (value: any) {
      setError(value?.response?.data?.detail || value?.message || 'Не удалось воспроизвести звук.')
    } finally { setPlaying(null) }
  }
  if (!capabilities.soundboard) return null
  return <div ref={rootRef} className="relative flex-1">
    <button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className={`voice-control h-11 w-full ${open ? 'is-active' : ''}`} aria-label="Звуковая панель" aria-expanded={open}><Music2 className="h-[18px] w-[18px]" /></button>
    {open && <section role="dialog" aria-label="Звуковая панель" className="absolute bottom-[calc(100%+8px)] left-0 z-[80] flex max-h-[390px] w-[310px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-2xl">
      <header className="border-b border-border p-4"><h3 className="font-bold">Звуковая панель</h3><p className="mt-1 text-xs text-text-muted">Короткие звуки услышат все в канале.</p></header>
      <div className="grid min-h-24 flex-1 grid-cols-2 gap-2 overflow-y-auto p-3">{sounds.map((sound) => <button key={sound.id} type="button" disabled={playing !== null} onClick={() => void play(sound)} className="flex min-h-16 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-left hover:border-primary/50 hover:bg-surface-hover"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">{playing === sound.id ? <Loader className="h-4 w-4 animate-spin" /> : <Music2 className="h-4 w-4" />}</span><span className="min-w-0 truncate text-sm font-semibold">{sound.name}</span></button>)}{!sounds.length && <p className="col-span-2 self-center text-center text-sm text-text-quiet">На сервере пока нет звуков.</p>}</div>
      {error && <p className="px-4 pb-2 text-xs text-red-300" role="alert">{error}</p>}
      <footer className="flex items-center gap-3 border-t border-border p-3"><button type="button" onClick={() => update({ ...settings, muted: !settings.muted })} className="rounded-md p-2 hover:bg-surface-hover" aria-label={settings.muted ? 'Включить звуки панели' : 'Отключить звуки панели'}>{settings.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button><input type="range" min="0" max="100" value={Math.round(settings.volume * 100)} onChange={(event) => update({ ...settings, volume: Number(event.target.value) / 100 })} className="min-w-0 flex-1 accent-primary" aria-label="Громкость звуковой панели" /></footer>
    </section>}
  </div>
}
