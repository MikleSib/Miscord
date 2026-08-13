'use client'

import {
  AlertCircle,
  Archive,
  BookOpen,
  Grid2X2,
  List,
  Loader2,
  MessageSquare as MessageSquareText,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GatewayEvents } from '../../lib/gatewayEvents'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import { cn } from '../../lib/utils'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import { useCommunityStore } from '../../store/communityStore'
import { useAuthStore } from '../../store/store'
import {
  EMPTY_FORUM,
  EMPTY_FORUM_POSTS,
  forumCacheKey,
  forumPostsKey,
  useForumCacheStore,
} from '../../store/forumCacheStore'
import type { Channel } from '../../types'
import { ForumPostCard } from './ForumPostCard'
import { ForumPostComposer } from './ForumPostComposer'
import { ForumTagManager } from './ForumTagManager'
import { applyForumMessageCreated, applyForumMessageDeleted } from './forumPostRealtime'

type ForumLayout = 'list' | 'gallery'
type ForumSort = 'latest_activity' | 'created_at'

function eventData<T>(payload: unknown): T {
  return payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data: T }).data
    : payload as T
}

interface ForumMessageEvent {
  id?: number
  message_id?: number
  channelId?: number
  text_channel_id?: number
  timestamp?: string
  created_at?: string
}

function ForumLoading() {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background" aria-label="Загрузка форума">
      <div className="h-16 shrink-0 animate-pulse border-b border-border bg-surface/30" />
      <div className="space-y-3 p-4 sm:p-6">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-surface" />)}
      </div>
    </main>
  )
}

export function ForumChannelView({ channel }: { channel: Channel }) {
  const ownerId = useAuthStore((state) => state.user?.id)
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [layout, setLayout] = useState<ForumLayout>('list')
  const [sort, setSort] = useState<ForumSort>('latest_activity')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [forumError, setForumError] = useState('')
  const [postsError, setPostsError] = useState('')
  const postQuery = useMemo(() => ({
    query: query.trim() || undefined,
    tag_ids: selectedTags.length ? selectedTags : undefined,
    include_archived: includeArchived,
    sort,
    limit: 100,
  }), [includeArchived, query, selectedTags, sort])
  const activeForumKey = ownerId ? forumCacheKey(ownerId, channel.id) : ''
  const activePostKey = ownerId ? forumPostsKey(ownerId, channel.id, postQuery) : ''
  const forumSnapshot = useForumCacheStore((state) => (
    activeForumKey ? state.forums[activeForumKey] ?? EMPTY_FORUM : EMPTY_FORUM
  ))
  const postsSnapshot = useForumCacheStore((state) => (
    activePostKey ? state.postLists[activePostKey] ?? EMPTY_FORUM_POSTS : EMPTY_FORUM_POSTS
  ))
  const refreshForumCache = useForumCacheStore((state) => state.refreshForum)
  const refreshPostsCache = useForumCacheStore((state) => state.refreshPosts)
  const updateCachedPosts = useForumCacheStore((state) => state.updatePosts)
  const forum = forumSnapshot.forum
  const posts = postsSnapshot.posts
  const forumLoading = !forumSnapshot.loaded
  const postsLoading = !postsSnapshot.loaded || postsSnapshot.refreshing
  const selectThread = useCommunityStore((state) => state.setSelectedThread)
  const { can } = useServerPermissions(channel.serverId)
  const canManage = can(Permissions.MANAGE_CHANNELS)
  const canCreate = can(Permissions.CREATE_PUBLIC_THREADS)

  const loadForum = useCallback(async (resetView = false) => {
    if (!ownerId) return null
    setForumError('')
    try {
      const value = await refreshForumCache(ownerId, channel.id)
      if (!value) return null
      if (resetView) {
        const savedLayout = typeof window === 'undefined'
          ? null
          : window.localStorage.getItem(`miscord:forum-layout:${channel.id}`)
        setLayout(savedLayout === 'gallery' || savedLayout === 'list' ? savedLayout : value.settings.default_layout)
        setSort(value.settings.default_sort)
      }
      return value
    } catch (reason: any) {
      setForumError(reason?.response?.data?.detail || 'Не удалось загрузить форум.')
      return null
    }
  }, [channel.id, ownerId, refreshForumCache])

  const loadPosts = useCallback(async (_background = false) => {
    if (!ownerId) return
    setPostsError('')
    try {
      await refreshPostsCache(ownerId, channel.id, postQuery)
    } catch (reason: any) {
      setPostsError(reason?.response?.data?.detail || 'Не удалось загрузить публикации.')
    }
  }, [channel.id, ownerId, postQuery, refreshPostsCache])

  useEffect(() => {
    setQuery('')
    setSelectedTags([])
    setIncludeArchived(false)
    void loadForum(true)
  }, [channel.id, loadForum])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPosts(), 220)
    return () => window.clearTimeout(timer)
  }, [loadPosts])

  useEffect(() => {
    const refreshPosts = (payload: unknown) => {
      const data = eventData<{ id?: number; parent_id?: number }>(payload)
      if (data.parent_id === channel.id || posts.some((post) => post.id === Number(data.id))) {
        void loadPosts(true)
      }
    }
    const refreshForum = (payload: unknown) => {
      const data = eventData<{ id?: number }>(payload)
      if (Number(data.id) === channel.id) void loadForum()
    }
    const updateReplyCount = (payload: unknown) => {
      const data = eventData<ForumMessageEvent>(payload)
      const targetId = Number(data.text_channel_id ?? data.channelId)
      if (!posts.some((post) => post.id === targetId)) return
      if (!ownerId) return
      updateCachedPosts(ownerId, channel.id, postQuery, (current) => applyForumMessageCreated(current, data))
      void loadPosts(true)
    }
    const updateDeletedReplyCount = (payload: unknown) => {
      const data = eventData<ForumMessageEvent>(payload)
      const targetId = Number(data.text_channel_id ?? data.channelId)
      if (!posts.some((post) => post.id === targetId)) return
      if (!ownerId) return
      updateCachedPosts(ownerId, channel.id, postQuery, (current) => applyForumMessageDeleted(current, data))
      void loadPosts(true)
    }
    unifiedWebSocketService.on(GatewayEvents.THREAD_CREATE, refreshPosts)
    unifiedWebSocketService.on(GatewayEvents.THREAD_UPDATE, refreshPosts)
    unifiedWebSocketService.on(GatewayEvents.THREAD_DELETE, refreshPosts)
    unifiedWebSocketService.on(GatewayEvents.FORUM_UPDATE, refreshForum)
    unifiedWebSocketService.on(GatewayEvents.NEW_MESSAGE, updateReplyCount)
    unifiedWebSocketService.on(GatewayEvents.MESSAGE_DELETED, updateDeletedReplyCount)
    return () => {
      unifiedWebSocketService.off(GatewayEvents.THREAD_CREATE, refreshPosts)
      unifiedWebSocketService.off(GatewayEvents.THREAD_UPDATE, refreshPosts)
      unifiedWebSocketService.off(GatewayEvents.THREAD_DELETE, refreshPosts)
      unifiedWebSocketService.off(GatewayEvents.FORUM_UPDATE, refreshForum)
      unifiedWebSocketService.off(GatewayEvents.NEW_MESSAGE, updateReplyCount)
      unifiedWebSocketService.off(GatewayEvents.MESSAGE_DELETED, updateDeletedReplyCount)
    }
  }, [channel.id, loadForum, loadPosts, ownerId, postQuery, posts, updateCachedPosts])

  const tagMap = useMemo(() => new Map(forum?.tags.map((tag) => [tag.id, tag]) || []), [forum?.tags])
  const hasFilters = Boolean(query.trim() || selectedTags.length || includeArchived)
  const clearFilters = () => {
    setQuery('')
    setSelectedTags([])
    setIncludeArchived(false)
  }
  const changeLayout = (next: ForumLayout) => {
    setLayout(next)
    window.localStorage.setItem(`miscord:forum-layout:${channel.id}`, next)
  }

  if (forumLoading) return <ForumLoading />
  if (!forum) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-background p-6 text-center">
        <div className="max-w-sm"><AlertCircle className="mx-auto h-8 w-8 text-red-300" /><h1 className="mt-3 font-semibold">Форум не загрузился</h1><p className="mt-1 text-sm text-text-quiet">{forumError}</p><button type="button" onClick={() => void loadForum(true)} className="mt-4 h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white">Повторить</button></div>
      </main>
    )
  }

  return (
    <main className="forum-channel-view flex min-h-0 flex-1 flex-col bg-background">
      <header className="forum-channel-header shrink-0 border-b border-border px-4 py-3 sm:px-6">
        <div className="forum-channel-header__row flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface text-text-body"><MessageSquareText className="h-5 w-5" /></span>
          <div className="forum-channel-header__identity min-w-0 flex-1">
            <h1 className="truncate font-bold text-foreground">{forum.name}</h1>
            <p className="text-xs text-text-quiet">Показано публикаций: {posts.length}{includeArchived ? ' · включая архив' : ''}</p>
          </div>
          <div className="forum-channel-header__actions flex shrink-0 items-center gap-1">
            {postsLoading && posts.length > 0 && <Loader2 className="h-4 w-4 animate-spin text-text-quiet" aria-label="Обновление" />}
            {canManage && <button type="button" onClick={() => setTagManagerOpen(true)} aria-label="Настройки форума" className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-text-quiet hover:bg-surface hover:text-foreground"><Settings2 className="h-4 w-4" /></button>}
            <button type="button" onClick={() => setCreateOpen(true)} disabled={!canCreate} aria-label="Новая публикация" title={!canCreate ? 'У вас нет права создавать публикации' : undefined} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-45"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Новая публикация</span></button>
          </div>
        </div>
        {forum.settings.guidelines && (
          <details className="mt-3 max-w-3xl text-sm text-text-quiet">
            <summary className="inline-flex cursor-pointer items-center gap-2 rounded-md py-1 font-medium text-text-body hover:text-foreground"><BookOpen className="h-4 w-4" />Правила форума</summary>
            <p className="mt-2 whitespace-pre-line leading-6">{forum.settings.guidelines}</p>
          </details>
        )}
      </header>

      <section aria-label="Фильтры форума" className="forum-channel-toolbar shrink-0 border-b border-border px-4 py-3 sm:px-6">
        <div className="forum-channel-toolbar-controls flex flex-wrap items-center gap-2">
          <label className="flex h-10 min-w-52 flex-[1_1_320px] items-center gap-2 rounded-md bg-canvas-deep px-3 focus-within:ring-2 focus-within:ring-primary">
            <Search className="h-4 w-4 shrink-0 text-text-quiet" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по заголовкам и сообщениям" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-quiet" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск" className="grid h-8 w-8 place-items-center rounded text-text-quiet hover:bg-surface hover:text-foreground"><X className="h-4 w-4" /></button>}
          </label>
          <label className="sr-only" htmlFor="forum-sort">Сортировка</label>
          <select id="forum-sort" value={sort} onChange={(event) => setSort(event.target.value as ForumSort)} className="forum-sort-select h-10 rounded-md bg-canvas-deep px-3 text-sm text-text-body outline-none focus:ring-2 focus:ring-primary">
            <option value="latest_activity">Недавняя активность</option>
            <option value="created_at">Новые публикации</option>
          </select>
          <button type="button" aria-label={includeArchived ? 'Скрыть архив' : 'Показать архив'} aria-pressed={includeArchived} onClick={() => setIncludeArchived((value) => !value)} className={cn('forum-archive-button inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm', includeArchived ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-text-quiet hover:bg-surface hover:text-foreground')}><Archive className="h-4 w-4" /><span className="forum-archive-label">Архив</span></button>
          <div className="forum-layout-switch flex h-10 rounded-md bg-canvas-deep p-1" role="group" aria-label="Вид публикаций">
            <button type="button" onClick={() => changeLayout('list')} aria-label="Список" aria-pressed={layout === 'list'} className={cn('grid w-8 place-items-center rounded', layout === 'list' ? 'bg-surface-raised text-white' : 'text-text-quiet hover:text-white')}><List className="h-4 w-4" /></button>
            <button type="button" onClick={() => changeLayout('gallery')} aria-label="Галерея" aria-pressed={layout === 'gallery'} className={cn('grid w-8 place-items-center rounded', layout === 'gallery' ? 'bg-surface-raised text-white' : 'text-text-quiet hover:text-white')}><Grid2X2 className="h-4 w-4" /></button>
          </div>
        </div>

        {forum.tags.length > 0 && (
          <div className="forum-tag-filter mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Фильтр по тегам">
            <button type="button" onClick={() => setSelectedTags([])} aria-pressed={selectedTags.length === 0} className={cn('min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium', selectedTags.length === 0 ? 'border-primary bg-primary/15 text-[#c4c8ff]' : 'border-border text-text-quiet hover:text-foreground')}>Все теги</button>
            {forum.tags.map((tag) => <button key={tag.id} type="button" aria-pressed={selectedTags.includes(tag.id)} onClick={() => setSelectedTags((ids) => ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id])} className={cn('min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium', selectedTags.includes(tag.id) ? 'border-primary bg-primary/15 text-[#c4c8ff]' : 'border-border text-text-quiet hover:text-foreground')}>{tag.emoji ? `${tag.emoji} ` : ''}{tag.name}</button>)}
          </div>
        )}
      </section>

      <div className="forum-post-list min-h-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-busy={postsLoading}>
        {postsError && (
          <div role="alert" className="mb-4 flex items-center gap-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-red-300"><AlertCircle className="h-5 w-5 shrink-0" /><span className="min-w-0 flex-1">{postsError}</span><button type="button" onClick={() => void loadPosts()} className="rounded-md px-3 py-2 font-semibold hover:bg-destructive/10">Повторить</button></div>
        )}

        {postsLoading && posts.length === 0 ? (
          <div className="space-y-3">{[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-surface" />)}</div>
        ) : posts.length > 0 ? (
          <div role="list" className={cn(layout === 'gallery' ? 'grid auto-rows-fr grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3' : 'space-y-2')}>
            {posts.map((post) => <div role="listitem" key={post.id}><ForumPostCard post={post} tags={tagMap} layout={layout} onOpen={() => selectThread(post)} /></div>)}
          </div>
        ) : (
          <div className="flex min-h-72 flex-col items-center justify-center px-4 text-center text-text-quiet">
            <SlidersHorizontal className="h-9 w-9 opacity-55" />
            <h2 className="mt-4 font-semibold text-text-body">{hasFilters ? 'Ничего не найдено' : 'Публикаций пока нет'}</h2>
            <p className="mt-1 max-w-sm text-sm leading-5">{hasFilters ? 'Измените запрос или сбросьте фильтры.' : 'Создайте первую публикацию, чтобы начать обсуждение.'}</p>
            {hasFilters ? <button type="button" onClick={clearFilters} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-raised"><RotateCcw className="h-4 w-4" />Сбросить фильтры</button> : canCreate && <button type="button" onClick={() => setCreateOpen(true)} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-brand-hover"><Plus className="h-4 w-4" />Создать публикацию</button>}
          </div>
        )}
      </div>

      <ForumPostComposer forum={forum} open={createOpen} canUseModeratedTags={can(Permissions.MANAGE_THREADS)} onClose={() => setCreateOpen(false)} onCreated={(post) => { selectThread(post); void loadPosts(true) }} />
      <ForumTagManager forum={forum} open={tagManagerOpen} onClose={() => setTagManagerOpen(false)} onChanged={async () => { await loadForum(true); await loadPosts(true) }} />
    </main>
  )
}
