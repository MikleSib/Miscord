'use client'

import { Archive, Grid2X2, List, Loader2, MessageSquare as MessageSquareText, Paperclip, Plus, Search, Settings2, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { communityApi } from '../../services/communityApi'
import uploadService from '../../services/uploadService'
import { useCommunityStore } from '../../store/communityStore'
import type { Channel } from '../../types'
import type { Forum, Thread } from '../../types/community'
import { cn } from '../../lib/utils'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import { ForumTagManager } from './ForumTagManager'
import { Modal } from '../ui/modal'

function PostComposer({ forum, open, canUseModeratedTags, onClose, onCreated }: { forum: Forum; open: boolean; canUseModeratedTags: boolean; onClose: () => void; onCreated: (thread: Thread) => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tagIds, setTagIds] = useState<number[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (open) { setTitle(''); setContent(''); setTagIds([]); setFiles([]); setError('') } }, [open])

  const submit = async () => {
    if (!title.trim() || !content.trim() || (forum.settings.require_tag && tagIds.length === 0)) return
    setLoading(true); setError('')
    const uploadedIds: string[] = []
    try {
      for (const uploaded of await uploadService.uploadFiles(files)) uploadedIds.push(uploaded.upload_id)
      const post = await communityApi.createForumPost(forum.id, { title: title.trim(), content: content.trim(), tag_ids: tagIds, attachment_upload_ids: uploadedIds })
      onCreated(post); onClose()
    } catch (reason: any) {
      await Promise.allSettled(uploadedIds.map((uploadId) => uploadService.deleteUpload(uploadId)))
      setError(reason?.response?.data?.detail || 'Не удалось опубликовать запись')
    } finally { setLoading(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новая публикация" contentClassName="max-w-2xl bg-surface-raised">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Новая публикация</h2><p className="mt-1 text-sm text-text-quiet">Начните отдельное обсуждение в «{forum.name}».</p></div><button type="button" onClick={onClose} aria-label="Закрыть" className="rounded p-1 text-text-quiet hover:bg-surface"><X className="h-5 w-5" /></button></div>
        {forum.settings.guidelines && <aside className="mt-4 border-l-2 border-primary bg-primary/[0.06] px-4 py-3 text-sm leading-6 text-text-body"><strong className="block text-foreground">Правила форума</strong>{forum.settings.guidelines}</aside>}
        {error && <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <label htmlFor="forum-post-title" className="mt-5 block text-xs font-bold uppercase tracking-wide text-text-quiet">Заголовок</label>
        <input id="forum-post-title" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} className="mt-2 h-11 w-full rounded-md bg-canvas-deep px-3 outline-none focus:ring-2 focus:ring-primary" />
        {forum.tags.length > 0 && <fieldset className="mt-4"><legend className="text-xs font-bold uppercase tracking-wide text-text-quiet">Теги {forum.settings.require_tag && '· обязательно'}</legend><div className="mt-2 flex flex-wrap gap-2">{forum.tags.map((tag) => <button key={tag.id} type="button" disabled={tag.moderated && !canUseModeratedTags} title={tag.moderated && !canUseModeratedTags ? 'Назначает только модератор' : undefined} onClick={() => setTagIds((ids) => ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id].slice(0, 5))} className={cn('rounded-full border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45', tagIds.includes(tag.id) ? 'border-primary bg-primary/15 text-[#c4c8ff]' : 'border-border bg-surface text-text-body')}>{tag.emoji} {tag.name}</button>)}</div></fieldset>}
        <label htmlFor="forum-post-content" className="mt-4 block text-xs font-bold uppercase tracking-wide text-text-quiet">Сообщение</label>
        <textarea id="forum-post-content" value={content} onChange={(event) => setContent(event.target.value)} rows={8} maxLength={5000} className="mt-2 w-full resize-y rounded-md bg-canvas-deep p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-primary" />
        <div className="mt-3 flex flex-wrap gap-2">{files.map((file, index) => <span key={`${file.name}:${file.lastModified}`} className="inline-flex max-w-full items-center gap-2 rounded-md bg-canvas-deep px-2.5 py-1.5 text-xs"><span className="truncate">{file.name}</span><button type="button" onClick={() => setFiles((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Убрать ${file.name}`} className="text-text-quiet hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button></span>)}</div>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-text-body hover:bg-surface"><Paperclip className="h-4 w-4" />Прикрепить файлы<input type="file" multiple className="sr-only" onChange={(event) => { const selected = Array.from(event.target.files || []); setFiles((items) => [...items, ...selected].slice(0, 10)); event.target.value = '' }} /></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm hover:bg-surface">Отмена</button><button type="button" onClick={() => void submit()} disabled={!title.trim() || !content.trim() || loading || (forum.settings.require_tag && tagIds.length === 0)} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50">{loading ? 'Публикация…' : 'Опубликовать'}</button></div>
      </div>
    </Modal>
  )
}

export function ForumChannelView({ channel }: { channel: Channel }) {
  const [forum, setForum] = useState<Forum | null>(null)
  const [posts, setPosts] = useState<Thread[]>([])
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [layout, setLayout] = useState<'list' | 'gallery'>('list')
  const [createOpen, setCreateOpen] = useState(false)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const selectThread = useCommunityStore((state) => state.setSelectedThread)
  const { can } = useServerPermissions(channel.serverId)

  const reloadForum = async () => {
    const value = await communityApi.getForum(channel.id)
    setForum(value)
    setLayout(value.settings.default_layout)
  }

  useEffect(() => {
    setLoading(true)
    void reloadForum().finally(() => setLoading(false))
  }, [channel.id])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void communityApi.listForumPosts(channel.id, { query: query || undefined, tag_ids: selectedTags.length ? selectedTags : undefined }).then(setPosts)
    }, 180)
    return () => window.clearTimeout(timer)
  }, [channel.id, query, selectedTags])

  const tagMap = useMemo(() => new Map(forum?.tags.map((tag) => [tag.id, tag]) || []), [forum?.tags])
  if (loading || !forum) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3"><MessageSquareText className="h-5 w-5 text-text-quiet" /><div className="min-w-0"><h1 className="truncate font-bold">{forum.name}</h1><p className="text-xs text-text-quiet">Форум · {posts.length} публикаций</p></div>{can(Permissions.MANAGE_CHANNELS) && <button type="button" onClick={() => setTagManagerOpen(true)} aria-label="Управление тегами" className="ml-auto rounded-md p-2 text-text-quiet hover:bg-surface hover:text-foreground"><Settings2 className="h-4 w-4" /></button>}<button type="button" onClick={() => setCreateOpen(true)} className={cn('inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white hover:bg-brand-hover', !can(Permissions.MANAGE_CHANNELS) && 'ml-auto')}><Plus className="h-4 w-4" /> <span className="hidden sm:inline">Новая публикация</span></button></div>
        {forum.settings.guidelines && <p className="mt-3 max-w-3xl text-sm leading-6 text-text-quiet">{forum.settings.guidelines}</p>}
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
        <label className="flex h-9 min-w-52 flex-1 items-center gap-2 rounded-md bg-canvas-deep px-3"><Search className="h-4 w-4 text-text-quiet" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск публикаций" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
        <div className="flex rounded-md bg-canvas-deep p-1"><button type="button" onClick={() => setLayout('list')} aria-label="Список" className={cn('rounded p-1.5', layout === 'list' && 'bg-surface-raised text-white')}><List className="h-4 w-4" /></button><button type="button" onClick={() => setLayout('gallery')} aria-label="Галерея" className={cn('rounded p-1.5', layout === 'gallery' && 'bg-surface-raised text-white')}><Grid2X2 className="h-4 w-4" /></button></div>
        {forum.tags.length > 0 && <div className="flex max-w-full gap-1 overflow-x-auto">{forum.tags.map((tag) => <button key={tag.id} type="button" onClick={() => setSelectedTags((ids) => ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id])} className={cn('whitespace-nowrap rounded-full border px-2.5 py-1 text-xs', selectedTags.includes(tag.id) ? 'border-primary bg-primary/15 text-[#c4c8ff]' : 'border-border text-text-quiet hover:text-foreground')}>{tag.emoji} {tag.name}</button>)}</div>}
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto p-4 sm:p-6', layout === 'gallery' ? 'grid auto-rows-min grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3' : 'space-y-2')}>
        {posts.map((post) => (
          <button key={post.id} type="button" onClick={() => selectThread(post)} className={cn('group w-full border border-border bg-surface text-left transition hover:border-primary/60 hover:bg-surface-raised', layout === 'gallery' ? 'min-h-40 rounded-xl p-4' : 'flex items-center gap-4 rounded-lg px-4 py-3')}>
            <MessageSquareText className="h-5 w-5 shrink-0 text-text-quiet group-hover:text-primary" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-foreground">{post.name}</span><span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-quiet">{post.archived_at && <><Archive className="h-3 w-3" /> Архив · </>}{post.member_count} участников{post.tag_ids?.map((id) => <span key={id} className="rounded-full bg-canvas-deep px-2 py-0.5">{tagMap.get(id)?.emoji} {tagMap.get(id)?.name}</span>)}</span></span>
          </button>
        ))}
        {posts.length === 0 && <div className="col-span-full flex min-h-64 flex-col items-center justify-center text-center text-text-quiet"><SlidersHorizontal className="mb-3 h-8 w-8 opacity-50" /><p className="font-medium text-text-body">Публикаций не найдено</p><p className="mt-1 text-sm">Измените фильтры или начните новое обсуждение.</p></div>}
      </div>
      <PostComposer forum={forum} open={createOpen} canUseModeratedTags={can(Permissions.MANAGE_THREADS)} onClose={() => setCreateOpen(false)} onCreated={(post) => { setPosts((items) => [post, ...items]); selectThread(post) }} />
      <ForumTagManager forum={forum} open={tagManagerOpen} onClose={() => setTagManagerOpen(false)} onChanged={reloadForum} />
    </main>
  )
}
