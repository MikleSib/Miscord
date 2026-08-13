import { create } from 'zustand'

import { communityApi } from '../services/communityApi'
import type { Message } from '../types'
import type { InboxNotification, NotificationType, Thread } from '../types/community'

type NotificationFilter = NotificationType | 'all'

interface NotificationSnapshot {
  items: InboxNotification[]
  cursor: number | null
  loaded: boolean
  loading: boolean
  revision: number
}

interface CommunityState {
  selectedThread: Thread | null
  threadPanelOpen: boolean
  notifications: InboxNotification[]
  unreadCount: number
  notificationFilter: NotificationFilter
  notificationCursor: number | null
  notificationsLoading: boolean
  notificationOwnerId: number | null
  notificationCaches: Partial<Record<NotificationFilter, NotificationSnapshot>>
  threadDraft: { channelId: number; message: Message } | null
  pendingMessageJump: { channelId: number; messageId: number } | null
  setSelectedThread: (thread: Thread | null) => void
  closeThreadPanel: () => void
  setNotificationOwner: (userId: number | null) => void
  setNotificationFilter: (filter: NotificationFilter) => void
  loadNotifications: (reset?: boolean) => Promise<void>
  refreshUnreadCount: () => Promise<void>
  markNotificationRead: (id: number) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  receiveNotification: (notification: InboxNotification) => void
  replaceNotification: (notification: InboxNotification) => void
  removeNotification: (id: number) => Promise<void>
  applyNotificationDeleted: (id: number) => void
  applyReadAll: () => void
  updateSelectedThread: (thread: Partial<Thread> & Pick<Thread, 'id'>) => void
  openThreadDraft: (channelId: number, message: Message) => void
  closeThreadDraft: () => void
  requestMessageJump: (channelId: number, messageId: number) => void
  clearMessageJump: () => void
}

const EMPTY_NOTIFICATIONS: NotificationSnapshot = Object.freeze({
  items: [], cursor: null, loaded: false, loading: false, revision: 0,
})
const notificationRequests = new Map<string, Promise<void>>()

function matches(filter: NotificationFilter, item: InboxNotification) {
  return filter === 'all' || filter === item.type
}

function mergeNotifications(server: InboxNotification[], current: InboxNotification[]) {
  const byId = new Map(server.map((item) => [item.id, item]))
  current.forEach((item) => byId.set(item.id, item))
  return Array.from(byId.values()).sort((left, right) => (
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  ))
}

function reconcileNotifications(
  server: InboxNotification[],
  current: InboxNotification[],
  baseline: InboxNotification[],
) {
  const baselineById = new Map(baseline.map((item) => [item.id, item]))
  const currentById = new Map(current.map((item) => [item.id, item]))
  const deleted = new Set(baseline.filter((item) => !currentById.has(item.id)).map((item) => item.id))
  const changed = current.filter((item) => (
    !baselineById.has(item.id) || baselineById.get(item.id) !== item
  ))
  return mergeNotifications(
    server.filter((item) => !deleted.has(item.id)),
    changed,
  )
}

function activeProjection(filter: NotificationFilter, snapshot: NotificationSnapshot) {
  return {
    notificationFilter: filter,
    notifications: snapshot.items,
    notificationCursor: snapshot.cursor,
    notificationsLoading: snapshot.loading,
  }
}

function updateCaches(
  state: CommunityState,
  update: (filter: NotificationFilter, snapshot: NotificationSnapshot) => NotificationSnapshot,
) {
  const filters = new Set<NotificationFilter>([
    ...Object.keys(state.notificationCaches) as NotificationFilter[],
    'all',
    state.notificationFilter,
  ])
  const notificationCaches = { ...state.notificationCaches }
  filters.forEach((filter) => {
    notificationCaches[filter] = update(filter, notificationCaches[filter] ?? EMPTY_NOTIFICATIONS)
  })
  const active = notificationCaches[state.notificationFilter] ?? EMPTY_NOTIFICATIONS
  return { notificationCaches, ...activeProjection(state.notificationFilter, active) }
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  selectedThread: null,
  threadPanelOpen: false,
  notifications: [],
  unreadCount: 0,
  notificationFilter: 'all',
  notificationCursor: null,
  notificationsLoading: false,
  notificationOwnerId: null,
  notificationCaches: {},
  threadDraft: null,
  pendingMessageJump: null,

  setSelectedThread: (selectedThread) => set({ selectedThread, threadPanelOpen: Boolean(selectedThread) }),
  closeThreadPanel: () => set({ selectedThread: null, threadPanelOpen: false }),
  setNotificationOwner: (notificationOwnerId) => set((state) => {
    if (state.notificationOwnerId === notificationOwnerId) return state
    notificationRequests.clear()
    return {
      notificationOwnerId,
      notificationCaches: {},
      notifications: [],
      notificationCursor: null,
      notificationsLoading: false,
      unreadCount: 0,
    }
  }),
  setNotificationFilter: (notificationFilter) => set((state) => {
    if (state.notificationFilter === notificationFilter) return state
    const snapshot = state.notificationCaches[notificationFilter] ?? EMPTY_NOTIFICATIONS
    return activeProjection(notificationFilter, snapshot)
  }),

  loadNotifications: async (reset = false) => {
    const start = get()
    const ownerId = start.notificationOwnerId
    if (ownerId == null) return
    const filter = start.notificationFilter
    const key = `${ownerId}:${filter}:${reset ? 'reset' : 'older'}`
    const pending = notificationRequests.get(key)
    if (pending) return pending
    const snapshot = start.notificationCaches[filter] ?? EMPTY_NOTIFICATIONS
    const baseline = snapshot.items
    if (!reset && snapshot.loading) return
    const revision = snapshot.revision
    const nextLoading = { ...snapshot, loading: true }
    set((state) => {
      if (state.notificationOwnerId !== ownerId) return state
      const notificationCaches = { ...state.notificationCaches, [filter]: nextLoading }
      return state.notificationFilter === filter
        ? { notificationCaches, ...activeProjection(filter, nextLoading) }
        : { notificationCaches }
    })

    const request = communityApi.listNotifications({
      type: filter === 'all' ? undefined : filter,
      before: reset ? undefined : snapshot.cursor ?? undefined,
      limit: 40,
    }).then((result) => {
      set((state) => {
        if (state.notificationOwnerId !== ownerId) return state
        const current = state.notificationCaches[filter] ?? EMPTY_NOTIFICATIONS
        const items = reset
          ? current.revision === revision
            ? result.items
            : reconcileNotifications(result.items, current.items, baseline)
          : mergeNotifications(current.items, result.items)
        const next = { ...current, items, cursor: result.next_cursor, loaded: true, loading: false }
        const notificationCaches = { ...state.notificationCaches, [filter]: next }
        return state.notificationFilter === filter
          ? { notificationCaches, ...activeProjection(filter, next) }
          : { notificationCaches }
      })
    }).catch((error) => {
      set((state) => {
        if (state.notificationOwnerId !== ownerId) return state
        const current = state.notificationCaches[filter] ?? EMPTY_NOTIFICATIONS
        const next = { ...current, loaded: true, loading: false }
        const notificationCaches = { ...state.notificationCaches, [filter]: next }
        return state.notificationFilter === filter
          ? { notificationCaches, ...activeProjection(filter, next) }
          : { notificationCaches }
      })
      throw error
    }).finally(() => notificationRequests.delete(key))
    notificationRequests.set(key, request)
    return request
  },

  refreshUnreadCount: async () => {
    const ownerId = get().notificationOwnerId
    if (ownerId == null) return
    try {
      const unreadCount = await communityApi.unreadNotificationCount()
      if (get().notificationOwnerId === ownerId) set({ unreadCount })
    }
    catch { /* Feature flag may still be disabled during staged rollout. */ }
  },

  markNotificationRead: async (id) => {
    const ownerId = get().notificationOwnerId
    const previous = get().notificationCaches.all?.items.find((item) => item.id === id)
    const updated = await communityApi.markNotificationRead(id)
    set((state) => {
      if (state.notificationOwnerId !== ownerId) return state
      return {
        ...updateCaches(state, (filter, snapshot) => ({
          ...snapshot,
          items: snapshot.items.map((item) => item.id === id && matches(filter, updated) ? updated : item),
          revision: snapshot.revision + 1,
        })),
        unreadCount: Math.max(0, state.unreadCount - Number(Boolean(previous && !previous.read_at))),
      }
    })
  },
  markAllNotificationsRead: async () => {
    const ownerId = get().notificationOwnerId
    await communityApi.markAllNotificationsRead()
    if (get().notificationOwnerId === ownerId) get().applyReadAll()
  },
  receiveNotification: (notification) => set((state) => {
    const existing = state.notificationCaches.all?.items.find((item) => item.id === notification.id)
    return {
      ...updateCaches(state, (filter, snapshot) => matches(filter, notification) ? {
        ...snapshot,
        items: [notification, ...snapshot.items.filter((item) => item.id !== notification.id)],
        revision: snapshot.revision + 1,
      } : snapshot),
      unreadCount: state.unreadCount + Number(!notification.read_at && !existing),
    }
  }),
  replaceNotification: (notification) => set((state) => {
    const previous = state.notificationCaches.all?.items.find((item) => item.id === notification.id)
    const unreadDelta = Number(!notification.read_at) - Number(Boolean(previous && !previous.read_at))
    return {
      ...updateCaches(state, (_filter, snapshot) => ({
        ...snapshot,
        items: snapshot.items.map((item) => item.id === notification.id ? notification : item),
        revision: snapshot.revision + 1,
      })),
      unreadCount: Math.max(0, state.unreadCount + unreadDelta),
    }
  }),
  removeNotification: async (id) => {
    const state = get()
    const ownerId = state.notificationOwnerId
    const previousCaches = state.notificationCaches
    const removed = previousCaches.all?.items.find((item) => item.id === id)
    state.applyNotificationDeleted(id)
    try { await communityApi.deleteNotification(id) }
    catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status
      if (status === 404 || !removed) return
      set((current) => {
        if (current.notificationOwnerId !== ownerId) return current
        return {
          ...updateCaches(current, (filter, snapshot) => matches(filter, removed) ? {
            ...snapshot,
            items: snapshot.items.some((item) => item.id === id)
              ? snapshot.items
              : mergeNotifications(snapshot.items, [removed]),
            revision: snapshot.revision + 1,
          } : snapshot),
          unreadCount: current.unreadCount + Number(!removed.read_at),
        }
      })
    }
  },
  applyNotificationDeleted: (id) => set((state) => {
    const removed = state.notificationCaches.all?.items.find((item) => item.id === id)
    return {
      ...updateCaches(state, (_filter, snapshot) => ({
        ...snapshot,
        items: snapshot.items.filter((item) => item.id !== id),
        revision: snapshot.revision + 1,
      })),
      unreadCount: Math.max(0, state.unreadCount - Number(Boolean(removed && !removed.read_at))),
    }
  }),
  applyReadAll: () => set((state) => ({
    ...updateCaches(state, (_filter, snapshot) => ({
      ...snapshot,
      items: snapshot.items.map((item) => ({
        ...item,
        read_at: item.read_at ?? new Date().toISOString(),
      })),
      revision: snapshot.revision + 1,
    })),
    unreadCount: 0,
  })),
  updateSelectedThread: (thread) => set((state) => state.selectedThread?.id === thread.id
    ? { selectedThread: { ...state.selectedThread, ...thread } }
    : state),
  openThreadDraft: (channelId, message) => set({ threadDraft: { channelId, message } }),
  closeThreadDraft: () => set({ threadDraft: null }),
  requestMessageJump: (channelId, messageId) => set({ pendingMessageJump: { channelId, messageId } }),
  clearMessageJump: () => set({ pendingMessageJump: null }),
}))
