'use client'

import { useEffect, useMemo, useState } from 'react'
import { ImageIcon, Music2, Play, Plus, Sticker, Trash2, Volume2 } from 'lucide-react'

import { cn } from '../../lib/utils'
import expressionService from '../../services/expressionService'
import type { Server, ServerExpression } from '../../types'
import { Button } from '../ui/button'
import { SoundUploadDialog, type SoundUploadValues } from './SoundUploadDialog'

type Kind = ServerExpression['kind']

const META: Record<Kind, { label: string; hint: string; accept: string; icon: typeof ImageIcon }> = {
  emoji: { label: 'Emoji', hint: 'До 256 КБ. PNG, WebP или GIF.', accept: 'image/png,image/webp,image/gif', icon: ImageIcon },
  sticker: { label: 'Стикеры', hint: 'До 512 КБ. Лучше всего 320×320.', accept: 'image/png,image/webp,image/gif', icon: Sticker },
  sound: { label: 'Звуки', hint: 'До 2 МБ и 5 секунд.', accept: 'audio/*', icon: Music2 },
}

function normalizeName(file: File): string {
  return file.name
    .replace(/\.[^.]+$/, '')
    .toLocaleLowerCase('ru')
    .replace(/[^a-zа-яё0-9_]+/gi, '_')
    .slice(0, 64)
}

export function ServerExpressionsTab({ server }: { server: Server }) {
  const [kind, setKind] = useState<Kind>('emoji')
  const [items, setItems] = useState<ServerExpression[]>([])
  const [soundFile, setSoundFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const meta = META[kind]

  useEffect(() => {
    let active = true
    void expressionService.list(server.id).then((next) => {
      if (active) setItems(next)
    }).catch(() => {
      if (active) setError('Не удалось загрузить медианаборы.')
    })
    return () => { active = false }
  }, [server.id])

  const visible = useMemo(
    () => items.filter((item) => item.kind === kind && item.available),
    [items, kind],
  )

  const create = async (file: File, name: string, options?: { emoji?: string | null; volume?: number }) => {
    setBusy(true)
    setError('')
    try {
      const item = await expressionService.create(server.id, kind, name, file, options)
      setItems((current) => [...current, item])
      setSoundFile(null)
    } catch (requestError: any) {
      setError(requestError.response?.data?.detail || requestError.message || 'Не удалось загрузить файл.')
      throw requestError
    } finally {
      setBusy(false)
    }
  }

  const chooseFile = async (file?: File) => {
    if (!file) return
    if (kind === 'sound') {
      setError('')
      setSoundFile(file)
      return
    }
    const name = window.prompt('Имя элемента', normalizeName(file))?.trim()
    if (name) await create(file, name).catch(() => undefined)
  }

  const uploadSound = async ({ file, name, emoji, volume }: SoundUploadValues) => {
    await create(file, name, { emoji, volume })
  }

  const remove = async (item: ServerExpression) => {
    await expressionService.remove(server.id, item.id)
    setItems((current) => current.filter((value) => value.id !== item.id))
  }

  const previewSound = async (item: ServerExpression) => {
    const bytes = await expressionService.soundAudio(item.id)
    const url = URL.createObjectURL(new Blob([bytes], { type: item.content_type }))
    const audio = new Audio(url)
    audio.volume = (item.volume ?? 100) / 100
    audio.onended = () => URL.revokeObjectURL(url)
    audio.onerror = () => URL.revokeObjectURL(url)
    try {
      await audio.play()
    } catch (playError) {
      URL.revokeObjectURL(url)
      throw playError
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">Emoji, стикеры и звуки</h2>
          <p className="mt-1 text-sm text-text-muted">Единый набор сервера доступен в чатах и голосовых каналах.</p>
        </div>
        <div className="mb-5 flex gap-2 overflow-x-auto border-b border-border">
          {(Object.keys(META) as Kind[]).map((value) => {
            const Icon = META[value].icon
            return (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={cn('flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold', kind === value ? 'border-primary text-white' : 'border-transparent text-text-muted hover:text-white')}
              >
                <Icon className="h-4 w-4" />{META[value].label}
              </button>
            )
          })}
        </div>
        {error && <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-300" role="alert">{error}</div>}
        <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4">
          <div>
            <p className="font-semibold text-white">{meta.label}</p>
            <p className="text-sm text-text-muted">{meta.hint}</p>
          </div>
          <label className="shrink-0">
            <input
              type="file"
              className="sr-only"
              accept={meta.accept}
              disabled={busy}
              onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = '' }}
            />
            <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-brand-hover">
              <Plus className="h-4 w-4" />Добавить
            </span>
          </label>
        </div>
        {visible.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((item) => (
              <article key={item.id} className="group relative overflow-hidden rounded-xl border border-border bg-surface p-3 transition-colors hover:border-white/15">
                <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-canvas-deep">
                  {kind === 'sound' ? (
                    <button type="button" onClick={() => void previewSound(item)} className="grid h-full w-full place-items-center text-primary hover:bg-primary/5" aria-label={`Прослушать ${item.name}`}>
                      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-2xl">{item.emoji || <Play className="h-6 w-6 fill-current" />}</span>
                    </button>
                  ) : (
                    <img src={item.file_url} alt={item.name} className="max-h-full max-w-full object-contain" />
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">:{item.name}:</span>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-text-quiet hover:text-destructive" onClick={() => void remove(item)} aria-label={`Удалить ${item.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {kind === 'sound' && <p className="mt-1 flex items-center gap-1 text-xs text-text-quiet"><Volume2 className="h-3 w-3" />{item.volume ?? 100}% · {((item.duration_ms || 0) / 1000).toFixed(2)} сек.</p>}
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-border text-sm text-text-quiet">Здесь пока пусто</div>
        )}
      </div>
      {soundFile && (
        <SoundUploadDialog
          file={soundFile}
          busy={busy}
          serverError={error}
          onClose={() => { if (!busy) { setSoundFile(null); setError('') } }}
          onUpload={uploadSound}
        />
      )}
    </div>
  )
}
