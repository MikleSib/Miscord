'use client'

import { Archive, ChevronLeft, Lock, LogOut, MoreHorizontal, Send, Settings2, Unlock, UserPlus, Users, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuthStore } from '../../store/store'
import { useCommunityStore } from '../../store/communityStore'
import { Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import { channelApi } from '../../services/api'
import { communityApi } from '../../services/communityApi'
import reactionService from '../../services/reactionService'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import type { Message } from '../../types'
import { ChatMessage } from '../ChatMessage'
import { ThreadMembersDialog } from './ThreadMembersDialog'
import { ThreadSettingsDialog } from './ThreadSettingsDialog'
import { useDismissOnOutsidePointer } from '../../hooks/useDismissOnOutsidePointer'

function eventData<T>(payload: any): T { return (payload?.data ?? payload) as T }
const threadScrollPositions = new Map<number, number>()

export function ThreadPanel() {
  const thread = useCommunityStore((state) => state.selectedThread)
  const closePanel = useCommunityStore((state) => state.closeThreadPanel)
  const updateSelected = useCommunityStore((state) => state.updateSelectedThread)
  const pendingMessageJump = useCommunityStore((state) => state.pendingMessageJump)
  const clearMessageJump = useCommunityStore((state) => state.clearMessageJump)
  const user = useAuthStore((state) => state.user)
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [menu, setMenu] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const { can } = useServerPermissions(thread?.server_id)
  const canManageThreads = can(Permissions.MANAGE_THREADS)

  useDismissOnOutsidePointer(panelRef, Boolean(thread && !membersOpen && !settingsOpen), closePanel)

  const load = useCallback(async () => {
    if (!thread) return
    setLoading(true)
    try {
      const result = await channelApi.getChannelMessages(thread.id, 50)
      setMessages(Array.isArray(result) ? result : result.messages || [])
    }
    finally { setLoading(false) }
  }, [thread?.id])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const html = document.documentElement
    if (thread) html.dataset.miscordThread = 'open'
    else delete html.dataset.miscordThread
    return () => { delete html.dataset.miscordThread }
  }, [thread])
  useLayoutEffect(() => {
    if (!thread || loading || !scrollRef.current) return
    const saved = threadScrollPositions.get(thread.id)
    scrollRef.current.scrollTop = saved ?? scrollRef.current.scrollHeight
  }, [thread?.id, loading])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || container.scrollHeight - container.scrollTop - container.clientHeight > 140) return
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  useEffect(() => {
    if (!thread || !pendingMessageJump || pendingMessageJump.channelId !== thread.id || loading) return
    const element = document.getElementById(`chat-message-${pendingMessageJump.messageId}`)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.classList.add('ring-2', 'ring-[#5865f2]', 'ring-offset-2', 'ring-offset-background')
    const timer = window.setTimeout(() => {
      element.classList.remove('ring-2', 'ring-[#5865f2]', 'ring-offset-2', 'ring-offset-background')
    }, 1600)
    clearMessageJump()
    return () => window.clearTimeout(timer)
  }, [clearMessageJump, loading, messages, pendingMessageJump, thread])

  useEffect(() => () => {
    if (thread && scrollRef.current) threadScrollPositions.set(thread.id, scrollRef.current.scrollTop)
  }, [thread?.id])

  useEffect(() => {
    if (!thread) return
    unifiedWebSocketService.subscribeChannel(thread.id)
    return () => unifiedWebSocketService.unsubscribeChannel(thread.id)
  }, [thread?.id])

  useEffect(() => {
    if (!thread) return
    const onMessage = (payload: any) => {
      const message = eventData<Message>(payload)
      const channelId = (message as any).text_channel_id ?? message.channelId
      if (channelId !== thread.id) return
      setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message])
    }
    const onEdit = (payload: any) => {
      const message = eventData<Message>(payload)
      setMessages((items) => items.map((item) => item.id === message.id ? message : item))
    }
    const onDelete = (payload: any) => {
      const data = eventData<{ message_id: number; text_channel_id: number }>(payload)
      if (data.text_channel_id === thread.id) setMessages((items) => items.filter((item) => item.id !== data.message_id))
    }
    unifiedWebSocketService.on('new_message', onMessage)
    unifiedWebSocketService.on('message_edited', onEdit)
    unifiedWebSocketService.on('message_deleted', onDelete)
    return () => {
      unifiedWebSocketService.off('new_message', onMessage)
      unifiedWebSocketService.off('message_edited', onEdit)
      unifiedWebSocketService.off('message_deleted', onDelete)
    }
  }, [thread?.id])

  if (!thread) return null
  const readonly = Boolean(thread.archived_at || (thread.locked && !canManageThreads))

  const send = (event: React.FormEvent) => {
    event.preventDefault()
    if (!content.trim() || readonly) return
    unifiedWebSocketService.sendChatMessage(thread.id, content.trim())
    setContent('')
  }

  const update = async (data: Partial<{ archived: boolean; locked: boolean }>) => {
    const updated = await communityApi.updateThread(thread.id, data)
    updateSelected(updated)
    setMenu(false)
  }

  return (
    <aside ref={panelRef} aria-label="Обсуждение" className="thread-panel fixed inset-0 z-[60] flex min-w-0 flex-col border-l border-border bg-background sm:static sm:z-auto sm:w-[420px] sm:max-w-[42vw]">
      <header className="thread-panel__header flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <button type="button" onClick={closePanel} aria-label="Назад" className="thread-panel__back hidden h-11 w-11 shrink-0 place-items-center rounded-md text-text-quiet hover:bg-surface hover:text-foreground sm:hidden"><ChevronLeft className="h-6 w-6" /></button>
        <div className="thread-panel__identity min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{thread.name}</p>
          <p className="text-[11px] text-text-quiet">Обсуждение · {thread.member_count} участников</p>
        </div>
        {thread.kind === 'private_thread' && <Lock className="h-4 w-4 text-text-quiet" aria-label="Приватное обсуждение" />}
        <div className="relative">
          <button type="button" onClick={() => setMenu((value) => !value)} aria-label="Управление обсуждением" className="grid h-11 w-11 place-items-center rounded-md text-text-quiet hover:bg-surface hover:text-foreground"><MoreHorizontal className="h-5 w-5" /></button>
          {menu && (
            <div className="absolute right-0 top-9 z-20 w-52 rounded-lg border border-border bg-surface-raised p-1 shadow-xl">
              {thread.kind === 'private_thread' && <button type="button" onClick={() => { setMembersOpen(true); setMenu(false) }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-primary"><Users className="h-4 w-4" /> Участники</button>}
              {thread.kind !== 'private_thread' && !thread.joined && <button type="button" onClick={() => void communityApi.joinThread(thread.id).then(() => updateSelected({ id: thread.id, joined: true, member_count: thread.member_count + 1 }))} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-primary"><UserPlus className="h-4 w-4" /> Присоединиться</button>}
              {thread.kind !== 'private_thread' && thread.joined && <button type="button" onClick={() => void communityApi.leaveThread(thread.id).then(() => updateSelected({ id: thread.id, joined: false, member_count: Math.max(0, thread.member_count - 1) }))} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-primary"><LogOut className="h-4 w-4" /> Покинуть</button>}
              <button type="button" onClick={() => { setSettingsOpen(true); setMenu(false) }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-primary"><Settings2 className="h-4 w-4" /> Настройки</button>
              <button type="button" onClick={() => void update({ archived: !thread.archived_at })} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-primary"><Archive className="h-4 w-4" /> {thread.archived_at ? 'Открыть снова' : 'Архивировать'}</button>
              <button type="button" onClick={() => void update({ locked: !thread.locked })} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-primary">{thread.locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />} {thread.locked ? 'Разблокировать' : 'Заблокировать'}</button>
            </div>
          )}
        </div>
        <button type="button" onClick={closePanel} aria-label="Закрыть обсуждение" className="grid h-11 w-11 place-items-center rounded-md text-text-quiet hover:bg-surface hover:text-foreground"><X className="h-5 w-5" /></button>
      </header>
      <div ref={scrollRef} className="thread-panel__messages min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {thread.starter_message_id && <p className="mb-3 border-l-2 border-primary px-3 py-1 text-xs text-text-quiet">Обсуждение сообщения #{thread.starter_message_id}</p>}
        {messages.map((message, index) => (
          <ChatMessage
            key={message.id}
            message={message}
            showAuthor={index === 0 || messages[index - 1]?.author.id !== message.author.id}
            currentUser={user || undefined}
            onReply={() => undefined}
            onReaction={(id, emoji) => { void reactionService.toggleReaction(id, emoji) }}
          />
        ))}
        {!loading && messages.length === 0 && <p className="px-6 py-12 text-center text-sm text-text-quiet">Начните обсуждение первым сообщением.</p>}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="thread-panel__composer border-t border-border p-3">
        {readonly && <p className="mb-2 text-xs text-[#f0b232]">Обсуждение доступно только для чтения.</p>}
        <div className="flex items-end gap-2 rounded-xl bg-surface px-3 py-2">
          <textarea rows={1} value={content} onChange={(event) => setContent(event.target.value)} disabled={readonly} placeholder={`Написать в ${thread.name}`} className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1 text-sm outline-none disabled:opacity-50" />
          <button type="submit" disabled={!content.trim() || readonly} aria-label="Отправить" className="flex h-11 w-11 items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:opacity-30"><Send className="h-4 w-4" /></button>
        </div>
      </form>
      <ThreadMembersDialog thread={thread} open={membersOpen} onClose={() => setMembersOpen(false)} onChanged={(memberCount) => updateSelected({ id: thread.id, member_count: memberCount })} />
      <ThreadSettingsDialog thread={thread} open={settingsOpen} onClose={() => setSettingsOpen(false)} onUpdated={updateSelected} onDeleted={closePanel} />
    </aside>
  )
}
