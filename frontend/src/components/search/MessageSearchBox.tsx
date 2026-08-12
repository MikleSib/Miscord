'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { SearchHasFilter, SearchResultMessage } from '../../services/searchService'
import { cn } from '../../lib/utils'
import { MessageSearchResults } from './MessageSearchResults'
import { useMessageSearch } from './useMessageSearch'

interface MessageSearchBoxProps {
  serverId: number | null
  /** Ограничить поиск текущим каналом. */
  currentChannelId: number | null
  currentChannelName?: string
  onJump: (message: SearchResultMessage) => void
}

const HAS_FILTERS: { value: SearchHasFilter; label: string }[] = [
  { value: 'link', label: 'Ссылки' },
  { value: 'image', label: 'Изображения' },
  { value: 'video', label: 'Видео' },
  { value: 'audio', label: 'Аудио' },
  { value: 'file', label: 'Файлы' },
  { value: 'poll', label: 'Опросы' },
  { value: 'embed', label: 'Embeds' },
]

export function MessageSearchBox({
  serverId,
  currentChannelId,
  currentChannelName,
  onJump,
}: MessageSearchBoxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useMessageSearch(serverId)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setIsOpen(true)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [])

  const close = () => {
    setIsOpen(false)
    search.reset()
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          'flex items-center gap-1.5 rounded bg-[#1e1f22] px-2 transition-[width]',
          isOpen ? 'w-[240px]' : 'w-[150px]',
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-[#949ba4]" />
        <input
          ref={inputRef}
          value={search.query}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            search.setQuery(event.target.value)
            setIsOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
              event.currentTarget.blur()
            }
          }}
          placeholder="Поиск"
          aria-label="Поиск сообщений"
          className="w-full bg-transparent py-1.5 text-sm text-[#dbdee1] outline-none placeholder:text-[#6d6f78]"
        />
        {search.query && (
          <button
            type="button"
            onClick={close}
            aria-label="Очистить поиск"
            className="shrink-0 text-[#949ba4] transition-colors hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 flex max-h-[520px] w-[420px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-[#1e1f22] bg-[#2b2d31] shadow-xl">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[#1e1f22] px-3 py-2">
            {currentChannelId != null && (
              <button
                type="button"
                onClick={() =>
                  search.setFilters((previous) => ({
                    ...previous,
                    channelId: previous.channelId ? null : currentChannelId,
                  }))
                }
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] transition-colors',
                  search.filters.channelId
                    ? 'bg-[#5865f2] text-white'
                    : 'bg-[#1e1f22] text-[#b5bac1] hover:text-white',
                )}
              >
                Только #{currentChannelName ?? 'канал'}
              </button>
            )}
            {HAS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() =>
                  search.setFilters((previous) => ({
                    ...previous,
                    has: previous.has === filter.value ? null : filter.value,
                  }))
                }
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] transition-colors',
                  search.filters.has === filter.value
                    ? 'bg-[#5865f2] text-white'
                    : 'bg-[#1e1f22] text-[#b5bac1] hover:text-white',
                )}
              >
                {filter.label}
              </button>
            ))}
            <button type="button" onClick={() => search.setFilters((value) => ({ ...value, pinned: value.pinned === true ? null : true }))} className={cn('rounded-full px-2.5 py-1 text-[11px] transition-colors', search.filters.pinned ? 'bg-[#5865f2] text-white' : 'bg-[#1e1f22] text-[#b5bac1] hover:text-white')}>Закреплённые</button>
            <button type="button" onClick={() => search.setFilters((value) => ({ ...value, sort: value.sort === 'newest' ? 'oldest' : 'newest' }))} className="rounded-full bg-[#1e1f22] px-2.5 py-1 text-[11px] text-[#b5bac1] hover:text-white">{search.filters.sort === 'newest' ? 'Сначала новые' : 'Сначала старые'}</button>
            <input type="number" min={1} value={search.filters.authorId ?? ''} onChange={(event) => search.setFilters((value) => ({ ...value, authorId: event.target.value ? Number(event.target.value) : null }))} className="h-7 w-24 rounded bg-[#1e1f22] px-2 text-[11px] text-white outline-none" placeholder="ID автора" aria-label="ID автора" />
            <input type="date" value={search.filters.after} onChange={(event) => search.setFilters((value) => ({ ...value, after: event.target.value }))} className="h-7 rounded bg-[#1e1f22] px-2 text-[11px] text-white" aria-label="Сообщения после даты" />
            <input type="date" value={search.filters.before} onChange={(event) => search.setFilters((value) => ({ ...value, before: event.target.value }))} className="h-7 rounded bg-[#1e1f22] px-2 text-[11px] text-white" aria-label="Сообщения до даты" />
          </div>

          <MessageSearchResults
            result={search.result}
            isLoading={search.isLoading}
            error={search.error}
            query={search.query}
            hasActiveFilter={search.filters.authorId != null || search.filters.has != null || search.filters.pinned != null || Boolean(search.filters.before || search.filters.after)}
            pageSize={search.pageSize}
            onGoToPage={search.goToPage}
            onJump={(message) => {
              onJump(message)
              setIsOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
