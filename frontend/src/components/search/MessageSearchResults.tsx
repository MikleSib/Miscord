'use client'

import { Hash, Loader2, SearchX } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { MessageSearchResponse, SearchResultMessage } from '../../services/searchService'
import { previewMessageText } from '../../lib/markdown'
import { UserAvatar } from '../ui/user-avatar'

interface MessageSearchResultsProps {
  result: MessageSearchResponse | null
  isLoading: boolean
  error: string | null
  query: string
  hasActiveFilter?: boolean
  pageSize: number
  onGoToPage: (offset: number) => void
  onJump: (message: SearchResultMessage) => void
}

export function MessageSearchResults({
  result,
  isLoading,
  error,
  query,
  hasActiveFilter = false,
  pageSize,
  onGoToPage,
  onJump,
}: MessageSearchResultsProps) {
  if (error) {
    return <p className="px-4 py-6 text-center text-sm text-[#f0b232]">{error}</p>
  }

  if (query.trim().length < 2 && !hasActiveFilter) {
    return (
      <p className="px-4 py-8 text-center text-sm text-[#949ba4]">
        Введите минимум два символа, чтобы найти сообщения
      </p>
    )
  }

  if (isLoading && !result) {
    return (
      <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-[#949ba4]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Поиск…
      </p>
    )
  }

  if (!result || result.messages.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <SearchX className="mx-auto mb-2 h-7 w-7 text-[#4e5058]" />
        <p className="text-sm text-[#949ba4]">Ничего не найдено</p>
      </div>
    )
  }

  const page = Math.floor(result.offset / pageSize) + 1
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize))

  return (
    <>
      <p className="px-4 py-2 text-xs uppercase tracking-wide text-[#949ba4]">
        Найдено: {result.total}
      </p>

      <div className="flex-1 overflow-y-auto">
        {result.messages.map((message) => (
          <button
            key={message.id}
            type="button"
            onClick={() => onJump(message)}
            className="flex w-full gap-3 border-b border-[#1e1f22] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#35373c]"
          >
            <UserAvatar user={message.author} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-white">
                  {message.author.display_name || message.author.username}
                </span>
                <span className="shrink-0 text-[11px] text-[#949ba4]">
                  {format(new Date(message.timestamp), 'd MMM yyyy, HH:mm', { locale: ru })}
                </span>
              </div>
              {message.channel_name && (
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[#949ba4]">
                  <Hash className="h-3 w-3" />
                  {message.channel_name}
                </span>
              )}
              <p className="mt-1 line-clamp-3 text-sm text-[#dbdee1]">
                {previewMessageText(message.content, 240) ||
                  (message.attachments.length > 0 ? 'Вложение' : '')}
              </p>
            </div>
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[#1e1f22] px-4 py-2 text-xs text-[#949ba4]">
          <button
            type="button"
            disabled={result.offset === 0 || isLoading}
            onClick={() => onGoToPage(Math.max(0, result.offset - pageSize))}
            className="rounded px-2 py-1 transition-colors hover:bg-[#ffffff14] disabled:opacity-40"
          >
            Назад
          </button>
          <span>
            {page} из {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || isLoading}
            onClick={() => onGoToPage(result.offset + pageSize)}
            className="rounded px-2 py-1 transition-colors hover:bg-[#ffffff14] disabled:opacity-40"
          >
            Вперёд
          </button>
        </div>
      )}
    </>
  )
}
