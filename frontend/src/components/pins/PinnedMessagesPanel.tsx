'use client'

import { useEffect, useRef } from 'react'
import { Pin, X } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { previewMessageText } from '../../lib/markdown'
import { UserAvatar } from '../ui/user-avatar'
import type { Message } from '../../types'

interface PinnedMessagesPanelProps {
  messages: Message[]
  canManage: boolean
  error: string | null
  onUnpin: (messageId: number) => void
  onClose: () => void
  onJumpToMessage?: (messageId: number) => void
}

export function PinnedMessagesPanel({
  messages,
  canManage,
  error,
  onUnpin,
  onClose,
  onJumpToMessage,
}: PinnedMessagesPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-40 mt-1 w-[420px] max-w-[92vw] overflow-hidden rounded-lg border border-[#1e1f22] bg-[#2b2d31] shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-[#1e1f22] px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Закреплённые сообщения</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="text-[#949ba4] transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {error && <p className="px-4 py-3 text-center text-sm text-[#f0b232]">{error}</p>}

        {messages.length === 0 && !error && (
          <div className="px-4 py-8 text-center">
            <Pin className="mx-auto mb-2 h-6 w-6 text-[#4e5058]" />
            <p className="text-sm text-[#949ba4]">
              В этом канале пока нет закреплённых сообщений
            </p>
          </div>
        )}

        {messages.map((message) => (
          <article
            key={message.id}
            className="group/pin flex gap-3 border-b border-[#1e1f22] px-4 py-3 last:border-b-0"
          >
            <UserAvatar user={message.author} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-white">
                  {message.author.display_name || message.author.username}
                </span>
                <span className="shrink-0 text-[11px] text-[#949ba4]">
                  {format(new Date(message.timestamp), 'd MMM, HH:mm', { locale: ru })}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-3 text-sm text-[#dbdee1]">
                {previewMessageText(message.content, 220) ||
                  (message.attachments.length > 0 ? 'Вложение' : 'Пустое сообщение')}
              </p>
              <div className="mt-1.5 flex items-center gap-3">
                {onJumpToMessage && (
                  <button
                    type="button"
                    className="text-xs text-[#00a8fc] hover:underline"
                    onClick={() => {
                      onJumpToMessage(message.id)
                      onClose()
                    }}
                  >
                    Перейти
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    className="text-xs text-[#949ba4] transition-colors hover:text-[#f23f43]"
                    onClick={() => onUnpin(message.id)}
                  >
                    Открепить
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
