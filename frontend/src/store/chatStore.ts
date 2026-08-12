import { create } from 'zustand'

import chatService from '../services/chatService'
import type { Message, Reaction } from '../types'
import {
  ChannelHistoryCacheEntry,
  dedupeMessages,
  mergeLatestMessagePage,
  writeChannelHistory,
} from './chatHistoryCache'

export const CHAT_PAGE_SIZE = 50

interface ChatState {
  messages: Message[]
  isLoading: boolean
  isRefreshing: boolean
  isLoadingOlder: boolean
  hasMoreOlder: boolean
  error: string | null
  currentChannelId: number | null
  cacheOwnerId: number | null
  cacheRevision: number
  channelCache: Record<number, ChannelHistoryCacheEntry>
  setCacheOwner: (userId: number | null) => void
  activateChannel: (channelId: number | null) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  prependMessages: (messages: Message[]) => void
  clearMessages: () => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setCurrentChannel: (channelId: number | null) => void
  loadMessageHistory: (channelId: number) => Promise<void>
  loadOlderMessages: () => Promise<number>
  ensureMessageLoaded: (messageId: number, maxPages?: number) => Promise<boolean>
  updateMessageReactions: (messageId: number, reactions: Reaction[]) => void
  updateSingleReaction: (messageId: number, emoji: string, reaction: Reaction) => void
  deleteMessage: (messageId: number) => void
  editMessage: (messageId: number, content: string) => void
}

const inFlightHistory = new Map<string, Promise<void>>()

function activeEntry(state: ChatState): ChannelHistoryCacheEntry | undefined {
  return state.currentChannelId == null ? undefined : state.channelCache[state.currentChannelId]
}

function cacheActiveMessages(
  state: ChatState,
  messages: Message[],
  patch: Partial<ChannelHistoryCacheEntry> = {},
) {
  if (state.currentChannelId == null) return state.channelCache
  const previous = activeEntry(state)
  const now = Date.now()
  return writeChannelHistory(state.channelCache, state.currentChannelId, {
    messages,
    hasMoreOlder: previous?.hasMoreOlder ?? state.hasMoreOlder,
    loadedOlder: previous?.loadedOlder ?? false,
    lastSyncedAt: previous?.lastSyncedAt ?? 0,
    lastAccessedAt: now,
    ...patch,
  })
}

function updateActiveMessages(
  state: ChatState,
  update: (messages: Message[]) => Message[],
) {
  const messages = update(state.messages)
  return { messages, channelCache: cacheActiveMessages(state, messages) }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  isRefreshing: false,
  isLoadingOlder: false,
  hasMoreOlder: false,
  error: null,
  currentChannelId: null,
  cacheOwnerId: null,
  cacheRevision: 0,
  channelCache: {},

  setCacheOwner: (userId) => set((state) => {
    if (state.cacheOwnerId === userId) return state
    inFlightHistory.clear()
    return {
      cacheOwnerId: userId,
      cacheRevision: state.cacheRevision + 1,
      channelCache: {},
      currentChannelId: null,
      messages: [],
      isLoading: false,
      isRefreshing: false,
      isLoadingOlder: false,
      hasMoreOlder: false,
      error: null,
    }
  }),

  activateChannel: (channelId) => set((state) => {
    if (channelId == null) {
      return {
        currentChannelId: null,
        messages: [],
        isLoading: false,
        isRefreshing: false,
        isLoadingOlder: false,
        hasMoreOlder: false,
        error: null,
      }
    }

    const cached = state.channelCache[channelId]
    const channelCache = cached
      ? writeChannelHistory(state.channelCache, channelId, {
          ...cached,
          lastAccessedAt: Date.now(),
        })
      : state.channelCache
    return {
      channelCache,
      currentChannelId: channelId,
      messages: cached?.messages ?? [],
      hasMoreOlder: cached?.hasMoreOlder ?? false,
      isLoading: !cached,
      isRefreshing: false,
      isLoadingOlder: false,
      error: null,
    }
  }),

  setMessages: (messages) => set((state) => ({
    messages,
    channelCache: cacheActiveMessages(state, messages),
  })),

  addMessage: (message) => set((state) => {
    const channelId = message.channelId ?? state.currentChannelId
    if (channelId == null) return state

    const cached = state.channelCache[channelId]
    const source = state.currentChannelId === channelId
      ? state.messages
      : cached?.messages ?? []
    if (source.some((candidate) => candidate.id === message.id)) return state

    const messages = [...source, message]
    const now = Date.now()
    const channelCache = writeChannelHistory(state.channelCache, channelId, {
      messages,
      hasMoreOlder: cached?.hasMoreOlder ?? (state.currentChannelId === channelId && state.hasMoreOlder),
      loadedOlder: cached?.loadedOlder ?? false,
      lastSyncedAt: cached?.lastSyncedAt ?? 0,
      lastAccessedAt: now,
    })
    return state.currentChannelId === channelId ? { messages, channelCache } : { channelCache }
  }),

  prependMessages: (messages) => set((state) => updateActiveMessages(
    state,
    (current) => dedupeMessages([...messages, ...current]),
  )),

  clearMessages: () => set((state) => ({
    messages: [],
    channelCache: cacheActiveMessages(state, [], { hasMoreOlder: false, loadedOlder: false }),
    hasMoreOlder: false,
    isLoadingOlder: false,
  })),

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setCurrentChannel: (channelId) => get().activateChannel(channelId),

  loadMessageHistory: async (channelId) => {
    const start = get()
    const revision = start.cacheRevision
    const cacheKey = `${revision}:${channelId}`
    const existing = inFlightHistory.get(cacheKey)
    if (existing) return existing

    const cached = start.channelCache[channelId]
    const idsAtStart = new Set((cached?.messages ?? []).map((message) => message.id))
    if (start.currentChannelId === channelId) {
      set({ isLoading: !cached, isRefreshing: Boolean(cached), error: null })
    }

    const request = (async () => {
      try {
        const result = await chatService.loadMessageHistory(channelId, CHAT_PAGE_SIZE)
        const state = get()
        if (state.cacheRevision !== revision) return

        const page = (result.messages ?? []).filter(
          (message: Message) => message.channelId == null || message.channelId === channelId,
        )
        const previous = state.channelCache[channelId]
        const messages = mergeLatestMessagePage(previous, page, idsAtStart)
        const now = Date.now()
        const channelCache = writeChannelHistory(state.channelCache, channelId, {
          messages,
          hasMoreOlder: previous?.loadedOlder
            ? previous.hasMoreOlder
            : Boolean(result.has_more),
          loadedOlder: previous?.loadedOlder ?? false,
          lastSyncedAt: now,
          lastAccessedAt: now,
        })
        if (state.currentChannelId === channelId) {
          set({
            channelCache,
            messages,
            hasMoreOlder: channelCache[channelId].hasMoreOlder,
            isLoading: false,
            isRefreshing: false,
            error: null,
          })
        } else {
          set({ channelCache })
        }
      } catch (error) {
        console.error('Не удалось загрузить историю сообщений:', error)
        const state = get()
        if (state.cacheRevision === revision && state.currentChannelId === channelId) {
          set({
            error: 'Не удалось обновить историю сообщений',
            isLoading: false,
            isRefreshing: false,
          })
        }
      }
    })()

    inFlightHistory.set(cacheKey, request)
    try {
      await request
    } finally {
      if (inFlightHistory.get(cacheKey) === request) inFlightHistory.delete(cacheKey)
    }
  },

  loadOlderMessages: async () => {
    const start = get()
    const { currentChannelId, messages, hasMoreOlder } = start
    if (
      currentChannelId == null ||
      !hasMoreOlder ||
      start.isLoadingOlder ||
      start.isLoading ||
      start.isRefreshing ||
      messages.length === 0
    ) return 0

    const revision = start.cacheRevision
    const oldestId = messages[0].id
    set({ isLoadingOlder: true })

    try {
      const result = await chatService.loadMessageHistory(currentChannelId, CHAT_PAGE_SIZE, oldestId)
      const state = get()
      if (state.cacheRevision !== revision) return 0

      const cached = state.channelCache[currentChannelId]
      const currentMessages = cached?.messages ?? messages
      const existing = new Set(currentMessages.map((message) => message.id))
      const older = (result.messages ?? []).filter(
        (message: Message) =>
          !existing.has(message.id) &&
          (message.channelId == null || message.channelId === currentChannelId),
      )
      const combined = dedupeMessages([...older, ...currentMessages])
      const now = Date.now()
      const channelCache = writeChannelHistory(state.channelCache, currentChannelId, {
        messages: combined,
        hasMoreOlder: Boolean(result.has_more),
        loadedOlder: true,
        lastSyncedAt: cached?.lastSyncedAt ?? now,
        lastAccessedAt: now,
      })
      if (state.currentChannelId === currentChannelId) {
        set({
          channelCache,
          messages: combined,
          hasMoreOlder: Boolean(result.has_more),
          isLoadingOlder: false,
        })
      } else {
        set({ channelCache })
      }
      return older.length
    } catch (error) {
      console.error('Не удалось загрузить старые сообщения:', error)
      if (get().currentChannelId === currentChannelId) set({ isLoadingOlder: false })
      return 0
    }
  },

  ensureMessageLoaded: async (messageId, maxPages = 12) => {
    for (let page = 0; page <= maxPages; page += 1) {
      const state = get()
      if (state.messages.some((message) => message.id === messageId)) return true
      if (!state.hasMoreOlder) return false
      if (state.messages.length > 0 && state.messages[0].id < messageId) return false
      const loaded = await get().loadOlderMessages()
      if (loaded === 0) return get().messages.some((message) => message.id === messageId)
    }
    return get().messages.some((message) => message.id === messageId)
  },

  updateMessageReactions: (messageId, reactions) => set((state) => updateActiveMessages(
    state,
    (messages) => messages.map((message) =>
      message.id === messageId ? { ...message, reactions } : message,
    ),
  )),

  updateSingleReaction: (messageId, emoji, reaction) => set((state) => updateActiveMessages(
    state,
    (messages) => messages.map((message) => {
      if (message.id !== messageId) return message
      const existing = message.reactions ?? []
      const index = existing.findIndex((candidate) => candidate.emoji === emoji)
      const reactions = reaction.count === 0
        ? existing.filter((candidate) => candidate.emoji !== emoji)
        : index >= 0
          ? existing.map((candidate, candidateIndex) => candidateIndex === index ? reaction : candidate)
          : [...existing, reaction]
      return { ...message, reactions }
    }),
  )),

  deleteMessage: (messageId) => set((state) => updateActiveMessages(
    state,
    (messages) => messages.filter((message) => message.id !== messageId),
  )),

  editMessage: (messageId, content) => set((state) => updateActiveMessages(
    state,
    (messages) => messages.map((message) =>
      message.id === messageId ? { ...message, content, is_edited: true } : message,
    ),
  )),
}))
