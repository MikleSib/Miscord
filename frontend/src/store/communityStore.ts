import { create } from 'zustand'
import { communityApi } from '../services/communityApi'
import type { Message } from '../types'
import type { InboxNotification, NotificationType, Thread } from '../types/community'

interface CommunityState {
  selectedThread: Thread | null
  threadPanelOpen: boolean
  notifications: InboxNotification[]
  unreadCount: number
  notificationFilter: NotificationType | 'all'
  notificationCursor: number | null
  notificationsLoading: boolean
  threadDraft: { channelId: number; message: Message } | null
  pendingMessageJump: { channelId: number; messageId: number } | null
  setSelectedThread: (thread: Thread | null) => void
  closeThreadPanel: () => void
  setNotificationFilter: (filter: NotificationType | 'all') => void
  loadNotifications: (reset?: boolean) => Promise<void>
  refreshUnreadCount: () => Promise<void>
  markNotificationRead: (id: number) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  receiveNotification: (notification: InboxNotification) => void
  replaceNotification: (notification: InboxNotification) => void
  removeNotification: (id: number) => Promise<void>
  applyReadAll: () => void
  updateSelectedThread: (thread: Partial<Thread> & Pick<Thread, 'id'>) => void
  openThreadDraft: (channelId: number, message: Message) => void
  closeThreadDraft: () => void
  requestMessageJump: (channelId: number, messageId: number) => void
  clearMessageJump: () => void
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  selectedThread: null,
  threadPanelOpen: false,
  notifications: [],
  unreadCount: 0,
  notificationFilter: 'all',
  notificationCursor: null,
  notificationsLoading: false,
  threadDraft: null,
  pendingMessageJump: null,

  setSelectedThread: (selectedThread) => set({ selectedThread, threadPanelOpen: Boolean(selectedThread) }),
  closeThreadPanel: () => set({ selectedThread: null, threadPanelOpen: false }),
  setNotificationFilter: (notificationFilter) => set({ notificationFilter, notificationCursor: null, notifications: [] }),

  loadNotifications: async (reset = false) => {
    const state = get()
    if (state.notificationsLoading) return
    set({ notificationsLoading: true })
    try {
      const result = await communityApi.listNotifications({
        type: state.notificationFilter === 'all' ? undefined : state.notificationFilter,
        before: reset ? undefined : state.notificationCursor ?? undefined,
        limit: 40,
      })
      set({
        notifications: reset ? result.items : [...state.notifications, ...result.items],
        notificationCursor: result.next_cursor,
        notificationsLoading: false,
      })
    } catch {
      set({ notificationsLoading: false })
    }
  },

  refreshUnreadCount: async () => {
    try {
      set({ unreadCount: await communityApi.unreadNotificationCount() })
    } catch {
      // Feature flag may still be disabled during staged rollout.
    }
  },

  markNotificationRead: async (id) => {
    const updated = await communityApi.markNotificationRead(id)
    set((state) => ({
      notifications: state.notifications.map((item) => item.id === id ? updated : item),
      unreadCount: Math.max(0, state.unreadCount - (state.notifications.find((item) => item.id === id)?.read_at ? 0 : 1)),
    }))
  },

  markAllNotificationsRead: async () => {
    await communityApi.markAllNotificationsRead()
    const readAt = new Date().toISOString()
    set((state) => ({ notifications: state.notifications.map((item) => ({ ...item, read_at: item.read_at ?? readAt })), unreadCount: 0 }))
  },

  receiveNotification: (notification) => set((state) => ({
    notifications: [notification, ...state.notifications.filter((item) => item.id !== notification.id)],
    unreadCount: state.unreadCount + (notification.read_at ? 0 : 1),
  })),
  replaceNotification: (notification) => set((state) => ({
    notifications: state.notifications.map((item) => item.id === notification.id ? notification : item),
    unreadCount: state.notifications.reduce((count, item) => count + Number(!(item.id === notification.id ? notification.read_at : item.read_at)), 0),
  })),
  removeNotification: async (id) => {
    const previous = get().notifications
    set({ notifications: previous.filter((item) => item.id !== id) })
    try { await communityApi.deleteNotification(id) }
    catch { set({ notifications: previous }) }
  },
  applyReadAll: () => set((state) => ({
    notifications: state.notifications.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })),
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
