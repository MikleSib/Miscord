'use client'

import { Bell, CheckCheck, ExternalLink, Inbox, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDismissOnOutsidePointer } from '../../hooks/useDismissOnOutsidePointer'
import { useStore } from '../../lib/store'
import { cn } from '../../lib/utils'
import { useCommunityStore } from '../../store/communityStore'
import { useAuthStore } from '../../store/store'
import type { InboxNotification, NotificationType } from '../../types/community'
import { communityApi } from '../../services/communityApi'

const FILTERS: Array<{ id: NotificationType | 'all'; label: string }> = [
  { id: 'all', label: 'Все' },
  { id: 'mention', label: 'Упоминания' },
  { id: 'reply', label: 'Ответы' },
  { id: 'friend_request', label: 'Друзья' },
  { id: 'application_response', label: 'Приложения' },
]

const LABELS: Record<NotificationType, string> = {
  mention: 'Вас упомянули',
  reply: 'Новый ответ',
  thread_reply: 'Ответ в обсуждении',
  reaction: 'Реакция на сообщение',
  friend_request: 'Запрос в друзья',
  server_invite: 'Приглашение на сервер',
  application_response: 'Ответ приложения',
}

function NotificationRow({ item, onOpen }: { item: InboxNotification; onOpen: () => void }) {
  const markRead = useCommunityStore((state) => state.markNotificationRead)
  const remove = useCommunityStore((state) => state.removeNotification)
  const actor = typeof item.payload.actor_name === 'string' ? item.payload.actor_name : null
  const context = typeof item.payload.context === 'string' ? item.payload.context : null

  return (
    <article className={cn('group relative border-b border-border/60 px-4 py-3', !item.read_at && 'bg-primary/[0.08]')}>
      <button
        type="button"
        onClick={() => { void markRead(item.id); onOpen() }}
        className="block w-full pr-9 text-left"
      >
        <div className="flex items-center gap-2">
          {!item.read_at && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Не прочитано" />}
          <span className="text-sm font-semibold text-foreground">{LABELS[item.type]}</span>
          <time className="ml-auto text-[11px] text-text-quiet">{new Date(item.created_at).toLocaleDateString('ru-RU')}</time>
        </div>
        {actor && <p className="mt-1 text-sm text-text-body">{actor}</p>}
        {context && <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-quiet">{context}</p>}
        {(item.channel_id || item.server_id) && (
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#aab1ff]">
            Открыть <ExternalLink className="h-3 w-3" />
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => { void remove(item.id) }}
        aria-label="Убрать уведомление"
        className="absolute right-2 top-8 grid h-11 w-11 place-items-center rounded-md text-text-quiet opacity-100 transition hover:bg-surface hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </article>
  )
}

export function NotificationInbox() {
  const [open, setOpen] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
    return Notification.permission
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const { selectServer, selectChannel } = useStore()
  const state = useCommunityStore()
  const ownerId = useAuthStore((auth) => auth.user?.id ?? null)
  const close = useCallback(() => setOpen(false), [])

  useDismissOnOutsidePointer(containerRef, open, close)

  useEffect(() => {
    state.setNotificationOwner(ownerId)
  }, [ownerId, state.setNotificationOwner])

  useEffect(() => {
    if (state.notificationOwnerId != null) void state.refreshUnreadCount()
  }, [state.notificationOwnerId, state.refreshUnreadCount])

  useEffect(() => {
    if (open && state.notificationOwnerId != null) {
      void state.loadNotifications(true).catch(() => undefined)
    }
  }, [open, state.notificationFilter, state.notificationOwnerId, state.loadNotifications])

  const openResource = async (item: InboxNotification) => {
    if (item.server_id) await selectServer(item.server_id)
    const threadId = typeof item.payload.thread_id === 'number' ? item.payload.thread_id : null
    if (threadId) {
      try {
        const thread = await communityApi.getThread(threadId)
        selectChannel(thread.parent_id, 'text')
        state.setSelectedThread(thread)
      } catch {
        // The thread may have been deleted or access revoked; keep the card usable.
      }
    } else if (item.channel_id) {
      selectChannel(item.channel_id, 'text')
    }
    if (item.channel_id && item.message_id) state.requestMessageJump(item.channel_id, item.message_id)
    setOpen(false)
  }

  const requestPushPermission = async () => {
    if (!('Notification' in window)) return
    const permission = await Notification.requestPermission()
    setPushPermission(permission)
  }

  return (
    <div ref={containerRef} className="relative z-[70]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Открыть уведомления"
        aria-expanded={open}
        className="interactive-row relative flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
        {state.unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f23f43] px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {state.unreadCount > 99 ? '99+' : state.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section role="dialog" aria-label="Входящие уведомления" className="notification-inbox fixed inset-x-2 top-14 flex max-h-[calc(100dvh-72px)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl sm:absolute sm:inset-auto sm:right-0 sm:top-10 sm:h-[560px] sm:w-[390px]">
          <header className="notification-inbox__header flex items-center gap-3 border-b border-border px-4 py-3">
            <Inbox className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold">Входящие</h2>
            <button
              type="button"
              onClick={() => void state.markAllNotificationsRead()}
              className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-text-quiet hover:bg-surface hover:text-foreground"
            >
              <CheckCheck className="h-4 w-4" /> Все прочитано
            </button>
            <button type="button" onClick={close} aria-label="Закрыть входящие" className="grid h-11 w-11 place-items-center rounded-md text-text-quiet hover:bg-surface hover:text-foreground sm:hidden">
              <X className="h-5 w-5" />
            </button>
          </header>
          <nav className="notification-inbox__filters flex gap-1 overflow-x-auto border-b border-border px-3 py-2" aria-label="Фильтры уведомлений">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => state.setNotificationFilter(filter.id)}
                className={cn('min-h-11 whitespace-nowrap rounded-md px-3 text-xs font-medium', state.notificationFilter === filter.id ? 'bg-primary text-white' : 'text-text-quiet hover:bg-surface hover:text-foreground')}
              >
                {filter.label}
              </button>
            ))}
          </nav>
          {pushPermission === 'default' && (
            <div className="flex items-center gap-3 border-b border-border bg-primary/[0.06] px-4 py-3">
              <Bell className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-xs leading-5 text-text-body">
                Включите системные уведомления, чтобы не пропускать ответы и упоминания.
              </p>
              <button
                type="button"
                onClick={() => void requestPushPermission()}
                className="min-h-11 shrink-0 rounded-md bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Включить
              </button>
            </div>
          )}
          {pushPermission === 'denied' && (
            <p className="border-b border-border px-4 py-2 text-xs leading-5 text-text-quiet">
              Системные уведомления заблокированы в настройках браузера. Входящие продолжат сохраняться здесь.
            </p>
          )}
          <div className="notification-inbox__list min-h-0 flex-1 overflow-y-auto">
            {state.notifications.map((item) => <NotificationRow key={item.id} item={item} onOpen={() => void openResource(item)} />)}
            {!state.notificationsLoading && state.notifications.length === 0 && (
              <div className="flex h-full min-h-56 flex-col items-center justify-center px-8 text-center text-text-quiet">
                <Inbox className="mb-3 h-9 w-9 opacity-50" />
                <p className="font-medium text-text-body">Здесь пока тихо</p>
                <p className="mt-1 text-sm">Упоминания, ответы и запросы будут сохраняться здесь.</p>
              </div>
            )}
            {state.notificationsLoading && <Loader2 className="mx-auto my-5 h-5 w-5 animate-spin text-primary" />}
            {!state.notificationsLoading && state.notificationCursor && (
              <button type="button" onClick={() => void state.loadNotifications()} className="w-full py-3 text-sm font-medium text-[#aab1ff] hover:bg-surface">Показать ещё</button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
