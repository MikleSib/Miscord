'use client'

import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import type { Forum } from '../../types/community'
import { Modal } from '../ui/modal'
import { Switch } from '../ui/switch'

interface ForumTagManagerProps {
  forum: Forum
  open: boolean
  onClose: () => void
  onChanged: () => Promise<void>
}

export function ForumTagManager({ forum, open, onClose, onChanged }: ForumTagManagerProps) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [moderated, setModerated] = useState(false)
  const [guidelines, setGuidelines] = useState('')
  const [layout, setLayout] = useState<'list' | 'gallery'>('list')
  const [sort, setSort] = useState<'latest_activity' | 'created_at'>('latest_activity')
  const [requireTag, setRequireTag] = useState(false)
  const [archiveMinutes, setArchiveMinutes] = useState(10080)
  const [slowMode, setSlowMode] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setEmoji('')
    setModerated(false)
    setGuidelines(forum.settings.guidelines || '')
    setLayout(forum.settings.default_layout)
    setSort(forum.settings.default_sort)
    setRequireTag(forum.settings.require_tag)
    setArchiveMinutes(forum.settings.auto_archive_minutes)
    setSlowMode(forum.settings.slow_mode_seconds)
    setError('')
  }, [forum, open])

  const saveSettings = async () => {
    setLoading(true)
    setError('')
    try {
      await communityApi.updateForum(forum.id, {
        guidelines: guidelines.trim() || null,
        default_layout: layout,
        default_sort: sort,
        require_tag: requireTag,
        auto_archive_minutes: archiveMinutes,
        slow_mode_seconds: slowMode,
      })
      await onChanged()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось сохранить настройки форума')
    } finally {
      setLoading(false)
    }
  }

  const add = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await communityApi.createForumTag(forum.id, {
        name: name.trim(),
        emoji: emoji.trim() || null,
        moderated,
      })
      setName('')
      setEmoji('')
      setModerated(false)
      await onChanged()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось создать тег')
    } finally {
      setLoading(false)
    }
  }

  const remove = async (tagId: number) => {
    setLoading(true)
    setError('')
    try {
      await communityApi.deleteForumTag(forum.id, tagId)
      await onChanged()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось удалить тег')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Теги форума" contentClassName="max-w-lg bg-surface-raised">
      <div className="p-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Теги форума</h2>
            <p className="mt-1 text-sm text-text-quiet">Модерируемые теги могут назначать только модераторы.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded p-1 text-text-quiet hover:bg-surface">
            <X className="h-5 w-5" />
          </button>
        </header>

        {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <section className="mt-5 space-y-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">Настройки публикаций</h3>
          <label className="block text-xs font-semibold text-text-quiet">Правила<textarea value={guidelines} onChange={(event) => setGuidelines(event.target.value)} maxLength={4000} rows={3} className="mt-1.5 w-full resize-y rounded-md bg-canvas-deep p-2.5 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-primary" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-text-quiet">Вид<select value={layout} onChange={(event) => setLayout(event.target.value as 'list' | 'gallery')} className="mt-1.5 h-10 w-full rounded-md bg-canvas-deep px-2 text-sm font-normal text-foreground"><option value="list">Список</option><option value="gallery">Галерея</option></select></label>
            <label className="text-xs font-semibold text-text-quiet">Сортировка<select value={sort} onChange={(event) => setSort(event.target.value as 'latest_activity' | 'created_at')} className="mt-1.5 h-10 w-full rounded-md bg-canvas-deep px-2 text-sm font-normal text-foreground"><option value="latest_activity">По активности</option><option value="created_at">По созданию</option></select></label>
            <label className="text-xs font-semibold text-text-quiet">Автоархив<select value={archiveMinutes} onChange={(event) => setArchiveMinutes(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md bg-canvas-deep px-2 text-sm font-normal text-foreground"><option value={60}>1 час</option><option value={1440}>1 день</option><option value={4320}>3 дня</option><option value={10080}>7 дней</option></select></label>
            <label className="text-xs font-semibold text-text-quiet">Slow mode<select value={slowMode} onChange={(event) => setSlowMode(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md bg-canvas-deep px-2 text-sm font-normal text-foreground"><option value={0}>Выкл.</option><option value={5}>5 сек.</option><option value={10}>10 сек.</option><option value={30}>30 сек.</option><option value={60}>1 мин.</option><option value={300}>5 мин.</option><option value={900}>15 мин.</option><option value={3600}>1 час</option></select></label>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">Обязательный тег<Switch checked={requireTag} onCheckedChange={setRequireTag} /></label>
          <button type="button" onClick={() => void saveSettings()} disabled={loading} className="h-9 rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">Сохранить настройки</button>
        </section>

        <h3 className="mt-6 text-sm font-semibold">Теги</h3>
        <div className="mt-5 flex gap-2">
          <input
            value={emoji}
            onChange={(event) => setEmoji(event.target.value)}
            aria-label="Эмодзи тега"
            maxLength={8}
            placeholder="🏷️"
            className="h-10 w-16 rounded-md bg-canvas-deep px-2 text-center outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Название тега"
            maxLength={32}
            placeholder="Название тега"
            className="h-10 min-w-0 flex-1 rounded-md bg-canvas-deep px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <button type="button" onClick={() => void add()} disabled={!name.trim() || loading} className="rounded-md bg-primary px-3 text-white disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="sr-only">Добавить тег</span>
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-text-body">
          <input type="checkbox" checked={moderated} onChange={(event) => setModerated(event.target.checked)} className="h-4 w-4 accent-primary" />
          Только модераторы смогут назначать этот тег
        </label>

        <div className="mt-5 space-y-2">
          {forum.tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
              <span className="text-lg">{tag.emoji || '🏷️'}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
              {tag.moderated && <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-[#c4c8ff]">Модерируемый</span>}
              <button type="button" onClick={() => void remove(tag.id)} disabled={loading} aria-label={`Удалить тег ${tag.name}`} className="rounded p-1.5 text-text-quiet hover:bg-destructive/10 hover:text-red-300">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {forum.tags.length === 0 && <p className="py-6 text-center text-sm text-text-quiet">Тегов пока нет.</p>}
        </div>
      </div>
    </Modal>
  )
}
