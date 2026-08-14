'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader, Smile, Upload, X } from 'lucide-react'

import { EmojiPickerPopover } from '../emoji/EmojiPickerPopover'
import { Button } from '../ui/button'
import { SoundWaveform } from './SoundWaveform'

const MAX_SOUND_BYTES = 2 * 1024 * 1024
const MAX_DURATION_MS = 5000

export interface SoundUploadValues {
  file: File
  name: string
  emoji: string | null
  volume: number
}

function suggestedName(file: File): string {
  return file.name
    .replace(/\.[^.]+$/, '')
    .toLocaleLowerCase('ru')
    .replace(/[^a-zа-яё0-9_]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

export function SoundUploadDialog({
  file,
  busy,
  serverError,
  onClose,
  onUpload,
}: {
  file: File
  busy: boolean
  serverError?: string
  onClose: () => void
  onUpload: (values: SoundUploadValues) => Promise<void>
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(() => suggestedName(file))
  const [emoji, setEmoji] = useState<string | null>(null)
  const [volume, setVolume] = useState(100)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [error, setError] = useState('')
  const onDuration = useCallback((value: number) => setDurationMs(value), [])

  useEffect(() => {
    nameRef.current?.focus()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [busy, onClose])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = name.trim()
    if (!normalized) return setError('Введите название звука.')
    if (file.size > MAX_SOUND_BYTES) return setError('Размер звука не должен превышать 2 МБ.')
    if (!durationMs) return setError('Не удалось прочитать длительность аудиофайла.')
    if (durationMs > MAX_DURATION_MS) return setError('Звук должен длиться не более 5 секунд.')
    setError('')
    try {
      await onUpload({ file, name: normalized, emoji, volume })
    } catch {
      // The parent keeps the dialog open and renders the localized API error.
    }
  }

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-black/70 p-3 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose() }}>
      <form onSubmit={(event) => void submit(event)} role="dialog" aria-modal="true" aria-labelledby="sound-upload-title" className="my-auto w-full max-w-lg overflow-visible rounded-2xl border border-border bg-surface-raised shadow-2xl">
        <header className="flex items-center justify-between px-5 py-4">
          <h2 id="sound-upload-title" className="text-lg font-bold text-white">Загрузить звук</h2>
          <button type="button" onClick={onClose} disabled={busy} className="grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-white" aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-5 px-5 pb-5">
          <section>
            <label className="mb-2 block text-sm font-semibold">Предпросмотр</label>
            <SoundWaveform file={file} onDuration={onDuration} />
          </section>
          <section>
            <label className="mb-2 block text-sm font-semibold">Файл</label>
            <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-input px-3 py-2.5">
              <Upload className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              <span className="shrink-0 text-xs text-text-quiet">{(file.size / 1024).toFixed(0)} КБ</span>
            </div>
          </section>
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <label className="block text-sm font-semibold">
              Название звука <span className="text-destructive">*</span>
              <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} maxLength={64} className="mt-2 h-11 w-full rounded-lg border border-border bg-input px-3 font-normal outline-none focus:border-primary" placeholder="Название звука" />
            </label>
            <div className="relative text-sm font-semibold">
              Соответствующий emoji
              <button type="button" onClick={() => setEmojiOpen((value) => !value)} className="mt-2 flex h-11 w-full items-center gap-2 rounded-lg border border-border bg-input px-3 text-left font-normal hover:border-primary">
                <span className="grid h-6 w-6 place-items-center text-lg">{emoji || <Smile className="h-5 w-5 text-text-muted" />}</span>
                <span className="truncate text-text-muted">{emoji ? 'Изменить' : 'Выбрать'}</span>
              </button>
              <EmojiPickerPopover open={emojiOpen} onClose={() => setEmojiOpen(false)} onSelect={(value) => { setEmoji(value); setEmojiOpen(false) }} className="bottom-[calc(100%+8px)] right-0" />
            </div>
          </div>
          <label className="block text-sm font-semibold">
            <span className="flex justify-between"><span>Громкость звука</span><span className="tabular-nums text-text-muted">{volume}%</span></span>
            <input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="mt-3 w-full accent-primary" />
          </label>
          {(error || serverError) && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-red-300" role="alert">{error || serverError}</p>}
        </div>
        <footer className="flex justify-end gap-2 rounded-b-2xl bg-canvas-deep px-5 py-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Отмена</Button>
          <Button type="submit" disabled={busy || durationMs === null || durationMs > MAX_DURATION_MS}>
            {busy && <Loader className="mr-2 h-4 w-4 animate-spin" />}Загрузить
          </Button>
        </footer>
      </form>
    </div>
  )
}
