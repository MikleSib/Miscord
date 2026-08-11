'use client'

import { Check, Loader2, Plus, Settings2, Tags, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
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

type ManagerTab = 'settings' | 'tags'

export function ForumTagManager({ forum, open, onClose, onChanged }: ForumTagManagerProps) {
  const [activeTab, setActiveTab] = useState<ManagerTab>('settings')
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
  const [saved, setSaved] = useState(false)
  const [deleteTagId, setDeleteTagId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const initializedForum = useRef<number | null>(null)

  useEffect(() => {
    if (!open) {
      initializedForum.current = null
      return
    }
    if (initializedForum.current === forum.id) return
    initializedForum.current = forum.id
    setActiveTab('settings')
    setName('')
    setEmoji('')
    setModerated(false)
    setGuidelines(forum.settings.guidelines || '')
    setLayout(forum.settings.default_layout)
    setSort(forum.settings.default_sort)
    setRequireTag(forum.settings.require_tag)
    setArchiveMinutes(forum.settings.auto_archive_minutes)
    setSlowMode(forum.settings.slow_mode_seconds)
    setDeleteTagId(null)
    setSaved(false)
    setError('')
  }, [forum, open])

  const saveSettings = async () => {
    setLoading(true)
    setSaved(false)
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
      setSaved(true)
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось сохранить настройки форума.')
    } finally {
      setLoading(false)
    }
  }

  const addTag = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await communityApi.createForumTag(forum.id, { name: name.trim(), emoji: emoji.trim() || null, moderated })
      setName('')
      setEmoji('')
      setModerated(false)
      await onChanged()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось создать тег.')
    } finally {
      setLoading(false)
    }
  }

  const removeTag = async (tagId: number) => {
    setLoading(true)
    setError('')
    try {
      await communityApi.deleteForumTag(forum.id, tagId)
      setDeleteTagId(null)
      await onChanged()
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Не удалось удалить тег.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} disableClose={loading} title="Настройки форума" contentClassName="max-h-[min(92dvh,760px)] max-w-xl overflow-hidden bg-surface-raised">
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div><h2 className="text-xl font-bold">Настройки форума</h2><p className="mt-1 text-sm text-text-quiet">Управляйте публикациями и тегами в одном месте.</p></div>
        <button type="button" onClick={onClose} disabled={loading} aria-label="Закрыть" className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-text-quiet hover:bg-surface hover:text-foreground disabled:opacity-40"><X className="h-5 w-5" /></button>
      </header>

      <div className="flex border-b border-border px-3" role="tablist" aria-label="Раздел настроек">
        <button type="button" role="tab" aria-selected={activeTab === 'settings'} onClick={() => setActiveTab('settings')} className={cn('relative flex min-h-11 items-center gap-2 px-3 text-sm font-semibold after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary', activeTab === 'settings' ? 'text-foreground after:block' : 'text-text-quiet after:hidden hover:text-foreground')}><Settings2 className="h-4 w-4" />Публикации</button>
        <button type="button" role="tab" aria-selected={activeTab === 'tags'} onClick={() => setActiveTab('tags')} className={cn('relative flex min-h-11 items-center gap-2 px-3 text-sm font-semibold after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary', activeTab === 'tags' ? 'text-foreground after:block' : 'text-text-quiet after:hidden hover:text-foreground')}><Tags className="h-4 w-4" />Теги <span className="rounded-full bg-canvas-deep px-2 py-0.5 text-[11px]">{forum.tags.length}</span></button>
      </div>

      <div className="max-h-[calc(min(92dvh,760px)-137px)] overflow-y-auto px-5 py-4">
        {error && <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        {activeTab === 'settings' ? (
          <section role="tabpanel" className="space-y-5">
            <label className="block text-sm font-semibold text-text-body">Правила форума<textarea value={guidelines} onChange={(event) => { setGuidelines(event.target.value); setSaved(false) }} maxLength={4000} rows={4} placeholder="Расскажите, для каких тем предназначен форум" className="mt-2 w-full resize-y rounded-md bg-canvas-deep p-3 text-sm font-normal leading-5 text-foreground outline-none placeholder:text-text-quiet focus:ring-2 focus:ring-primary" /></label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-text-body">Вид по умолчанию<select value={layout} onChange={(event) => { setLayout(event.target.value as 'list' | 'gallery'); setSaved(false) }} className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-primary"><option value="list">Список</option><option value="gallery">Галерея</option></select></label>
              <label className="text-sm font-semibold text-text-body">Сортировка<select value={sort} onChange={(event) => { setSort(event.target.value as 'latest_activity' | 'created_at'); setSaved(false) }} className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-primary"><option value="latest_activity">Недавняя активность</option><option value="created_at">Новые публикации</option></select></label>
              <label className="text-sm font-semibold text-text-body">Автоархив<select value={archiveMinutes} onChange={(event) => { setArchiveMinutes(Number(event.target.value)); setSaved(false) }} className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-primary"><option value={60}>1 час</option><option value={1440}>1 день</option><option value={4320}>3 дня</option><option value={10080}>7 дней</option></select></label>
              <label className="text-sm font-semibold text-text-body">Интервал между публикациями<select value={slowMode} onChange={(event) => { setSlowMode(Number(event.target.value)); setSaved(false) }} className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-primary"><option value={0}>Без ограничений</option><option value={5}>5 секунд</option><option value={10}>10 секунд</option><option value={30}>30 секунд</option><option value={60}>1 минута</option><option value={300}>5 минут</option><option value={900}>15 минут</option><option value={3600}>1 час</option></select></label>
            </div>
            <label className="flex items-start justify-between gap-4 rounded-lg bg-canvas-deep px-4 py-3"><span><span className="block text-sm font-semibold">Требовать тег</span><span className="mt-1 block text-xs leading-5 text-text-quiet">Без выбранного тега публикацию нельзя будет создать.</span></span><Switch checked={requireTag} onCheckedChange={(value) => { setRequireTag(value); setSaved(false) }} /></label>
            <div className="flex items-center gap-3"><button type="button" onClick={() => void saveSettings()} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">{loading && <Loader2 className="h-4 w-4 animate-spin" />}Сохранить</button>{saved && <span role="status" className="inline-flex items-center gap-1.5 text-sm text-success"><Check className="h-4 w-4" />Сохранено</span>}</div>
          </section>
        ) : (
          <section role="tabpanel">
            <form onSubmit={addTag} className="rounded-lg bg-canvas-deep p-4">
              <h3 className="text-sm font-semibold">Новый тег</h3>
              <div className="mt-3 flex gap-2">
                <input value={emoji} onChange={(event) => setEmoji(event.target.value)} aria-label="Эмодзи тега" maxLength={8} placeholder="🏷️" className="h-11 w-16 rounded-md bg-surface px-2 text-center outline-none focus:ring-2 focus:ring-primary" />
                <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Название тега" maxLength={32} placeholder="Название тега" className="h-11 min-w-0 flex-1 rounded-md bg-surface px-3 text-sm outline-none placeholder:text-text-quiet focus:ring-2 focus:ring-primary" />
                <button type="submit" disabled={!name.trim() || loading} className="grid h-11 w-11 place-items-center rounded-md bg-primary text-white hover:bg-brand-hover disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}<span className="sr-only">Добавить тег</span></button>
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm text-text-body"><input type="checkbox" checked={moderated} onChange={(event) => setModerated(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" /><span>Только модераторы смогут назначать этот тег</span></label>
            </form>

            <div className="mt-4 space-y-2">
              {forum.tags.map((tag) => (
                <div key={tag.id} className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-canvas-deep text-lg">{tag.emoji || '🏷️'}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{tag.name}</span>{tag.moderated && <span className="text-xs text-text-quiet">Назначают модераторы</span>}</span>
                  {deleteTagId === tag.id ? <span className="flex items-center gap-1"><button type="button" onClick={() => void removeTag(tag.id)} disabled={loading} className="h-9 rounded-md bg-destructive px-3 text-xs font-semibold text-white disabled:opacity-50">Удалить</button><button type="button" onClick={() => setDeleteTagId(null)} className="h-9 rounded-md px-3 text-xs hover:bg-canvas-deep">Отмена</button></span> : <button type="button" onClick={() => setDeleteTagId(tag.id)} aria-label={`Удалить тег ${tag.name}`} className="grid h-10 w-10 place-items-center rounded-md text-text-quiet hover:bg-destructive/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
              {forum.tags.length === 0 && <p className="py-10 text-center text-sm text-text-quiet">Тегов пока нет. Создайте первый тег выше.</p>}
            </div>
          </section>
        )}
      </div>
    </Modal>
  )
}
