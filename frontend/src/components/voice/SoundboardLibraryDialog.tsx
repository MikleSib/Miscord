'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Loader, Music2, Search, Star, Volume2, VolumeX, X } from 'lucide-react'

import { useStore } from '../../lib/store'
import expressionService from '../../services/expressionService'
import {
  frequentSoundIds,
  getSoundboardLibrary,
  recordSoundUse,
  toggleFavorite,
} from '../../services/soundboardLibrary'
import { getSoundboardSettings, setSoundboardSettings } from '../../services/soundboardSettings'
import { playSoundboardAudio } from '../../services/voice/soundboardPlayback'
import type { ServerExpression } from '../../types'

type Section = 'favorites' | 'frequent' | 'server'

function SoundButton({
  sound,
  favorite,
  playing,
  onPlay,
  onFavorite,
}: {
  sound: ServerExpression
  favorite: boolean
  playing: boolean
  onPlay: () => void
  onFavorite: () => void
}) {
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onPlay}
        disabled={playing}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-surface px-3 text-sm font-semibold text-text-normal ring-1 ring-inset ring-white/[0.04] transition-colors hover:bg-surface-hover hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title={sound.name}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center text-base" aria-hidden="true">
          {playing ? <Loader className="h-4 w-4 animate-spin text-primary" /> : sound.emoji || <Music2 className="h-4 w-4 text-text-muted" />}
        </span>
        <span className="truncate">{sound.name}</span>
      </button>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onFavorite() }}
        className={`absolute right-1 top-1 rounded p-1 transition-opacity hover:bg-black/20 focus-visible:opacity-100 ${favorite ? 'text-amber-300 opacity-100' : 'text-text-muted opacity-0 group-hover:opacity-100'}`}
        aria-label={favorite ? `Убрать ${sound.name} из избранного` : `Добавить ${sound.name} в избранное`}
      >
        <Star className={`h-3.5 w-3.5 ${favorite ? 'fill-current' : ''}`} />
      </button>
    </div>
  )
}

export function SoundboardLibraryDialog({
  serverId,
  channelId,
  onClose,
}: {
  serverId: number
  channelId: number
  onClose: () => void
}) {
  const servers = useStore((state) => state.servers)
  const server = servers.find((item) => item.id === serverId)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [sounds, setSounds] = useState<ServerExpression[]>([])
  const [library, setLibrary] = useState(getSoundboardLibrary)
  const [settings, setSettings] = useState(getSoundboardSettings)
  const [section, setSection] = useState<Section>('server')
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void expressionService.list(serverId, 'sound').then((items) => {
      if (active) setSounds(items)
    }).catch(() => {
      if (active) setError('Не удалось загрузить звуковую панель.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    searchRef.current?.focus()
    const pointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('keydown', key)
    return () => {
      active = false
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('keydown', key)
    }
  }, [onClose, serverId])

  const favoriteIds = useMemo(() => new Set(library.favorites), [library.favorites])
  const frequentIds = useMemo(() => frequentSoundIds(library), [library])
  const selectedSounds = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru')
    let items = sounds
    if (section === 'favorites') items = items.filter((item) => favoriteIds.has(item.id))
    if (section === 'frequent') {
      const order = new Map(frequentIds.map((id, index) => [id, index]))
      items = items.filter((item) => order.has(item.id)).sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0))
    }
    return normalized ? items.filter((item) => item.name.toLocaleLowerCase('ru').includes(normalized)) : items
  }, [favoriteIds, frequentIds, query, section, sounds])

  const updateSettings = (next: typeof settings) => {
    setSettings(next)
    setSoundboardSettings(next)
  }
  const play = async (sound: ServerExpression) => {
    if (playing !== null) return
    setPlaying(sound.id)
    setError('')
    try {
      const bytes = await expressionService.soundAudio(sound.id)
      const playback = await expressionService.soundboardTicket(channelId, sound.id)
      setLibrary(recordSoundUse(sound.id))
      await playSoundboardAudio(
        bytes,
        playback.ticket,
        (playback.sound.volume ?? 100) / 100,
      )
    } catch (value: any) {
      setError(value?.response?.data?.detail || value?.message || 'Не удалось воспроизвести звук.')
    } finally {
      setPlaying(null)
    }
  }

  const sectionButton = (value: Section, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setSection(value)}
      className={`grid h-10 w-10 place-items-center rounded-xl transition-colors ${section === value ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-hover hover:text-white'}`}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  )

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Звуковая панель"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[120] flex h-[min(540px,calc(100dvh-24px))] overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-[calc(100%+10px)] sm:left-0 sm:h-[500px] sm:w-[520px]"
    >
      <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border bg-canvas-deep py-3">
        {sectionButton('favorites', 'Избранное', <Star className="h-5 w-5" />)}
        {sectionButton('frequent', 'Часто используемые', <Clock3 className="h-5 w-5" />)}
        <div className="my-1 h-px w-8 bg-border" />
        <button
          type="button"
          onClick={() => setSection('server')}
          className={`grid h-10 w-10 place-items-center overflow-hidden rounded-xl text-xs font-bold transition-colors ${section === 'server' ? 'bg-primary text-white' : 'bg-surface text-text-normal hover:bg-surface-hover'}`}
          aria-label={server?.name || 'Текущий сервер'}
          title={server?.name || 'Текущий сервер'}
        >
          {server?.icon ? <img src={server.icon} alt="" className="h-full w-full object-cover" /> : (server?.name || 'S').slice(0, 2).toUpperCase()}
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border p-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent bg-input px-3 focus-within:border-primary">
            <Search className="h-4 w-4 shrink-0 text-text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найдите идеальный звук"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-quiet"
            />
          </label>
          <button
            type="button"
            onClick={() => updateSettings({ ...settings, muted: !settings.muted })}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-white"
            aria-label={settings.muted ? 'Включить звуки панели' : 'Отключить звуки панели'}
          >
            {settings.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-white sm:hidden" aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="truncate text-sm font-bold text-text-normal">
              {section === 'favorites' ? 'Избранное' : section === 'frequent' ? 'Часто используемые' : server?.name || 'Звуки сервера'}
            </h3>
            <span className="text-xs text-text-quiet">{selectedSounds.length}</span>
          </div>
          {loading ? (
            <div className="grid min-h-40 place-items-center"><Loader className="h-5 w-5 animate-spin text-primary" /></div>
          ) : selectedSounds.length ? (
            <div className="grid grid-cols-2 gap-2 min-[460px]:grid-cols-3">
              {selectedSounds.map((sound) => (
                <SoundButton
                  key={sound.id}
                  sound={sound}
                  favorite={favoriteIds.has(sound.id)}
                  playing={playing === sound.id}
                  onPlay={() => void play(sound)}
                  onFavorite={() => setLibrary(toggleFavorite(sound.id))}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-40 place-items-center px-6 text-center text-sm text-text-quiet">
              {query ? 'По вашему запросу ничего не найдено.' : section === 'favorites' ? 'Добавляйте любимые звуки звёздочкой.' : section === 'frequent' ? 'Здесь появятся часто используемые звуки.' : 'На сервере пока нет звуков.'}
            </div>
          )}
          {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-red-300" role="alert">{error}</p>}
        </div>
        <footer className="flex items-center gap-3 border-t border-border px-4 py-3">
          {settings.muted ? <VolumeX className="h-4 w-4 text-text-muted" /> : <Volume2 className="h-4 w-4 text-text-muted" />}
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(settings.volume * 100)}
            onChange={(event) => updateSettings({ ...settings, volume: Number(event.target.value) / 100 })}
            className="min-w-0 flex-1 accent-primary"
            aria-label="Громкость звуковой панели"
          />
          <span className="w-9 text-right text-xs tabular-nums text-text-quiet">{Math.round(settings.volume * 100)}%</span>
        </footer>
      </div>
    </div>
  )
}
