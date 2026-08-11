'use client'

import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import {
  findEmojiByChar,
  rememberRecentEmoji,
  searchEmoji,
  type EmojiCategory,
  type EmojiEntry,
} from '../../lib/emoji'
import { cn } from '../../lib/utils'
import { EmojiGrid } from './EmojiGrid'
import { useEmojiData } from './useEmojiData'

interface EmojiPickerProps {
  onSelect: (char: string) => void
  /** Пикер остаётся открытым для нескольких реакций подряд. */
  keepOpenOnSelect?: boolean
  onClose?: () => void
  className?: string
}

export function EmojiPicker({
  onSelect,
  keepOpenOnSelect = false,
  onClose,
  className,
}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const { categories, recent, setRecent } = useEmojiData(true)

  const recentEntries = useMemo<EmojiEntry[]>(() => {
    if (!categories || recent.length === 0) return []
    return recent
      .map((char) => findEmojiByChar(categories, char) ?? ([char, char, ''] as EmojiEntry))
      .slice(0, 18)
  }, [categories, recent])

  const results = useMemo(
    () => (categories && query.trim() ? searchEmoji(categories, query) : []),
    [categories, query],
  )

  const select = (char: string) => {
    setRecent(rememberRecentEmoji(char))
    onSelect(char)
    if (!keepOpenOnSelect) onClose?.()
  }

  const scrollToCategory = (category: EmojiCategory) => {
    setQuery('')
    requestAnimationFrame(() => {
      const target = scrollRef.current?.querySelector(`[data-category="${category.id}"]`)
      target?.scrollIntoView({ block: 'start' })
    })
  }

  return (
    <div
      role="dialog"
      aria-label="Выбор эмодзи"
      className={cn(
        'emoji-picker-panel flex h-[340px] w-[340px] flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl',
        className,
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="p-2">
        <div className="flex items-center gap-2 rounded bg-[#1e1f22] px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-[#949ba4]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose?.()
              }
            }}
            placeholder="Поиск эмодзи"
            aria-label="Поиск эмодзи"
            className="w-full bg-transparent py-1.5 text-sm text-[#dbdee1] outline-none placeholder:text-[#6d6f78]"
          />
        </div>
      </div>

      {!categories ? (
        <p className="flex flex-1 items-center justify-center text-xs text-[#949ba4]">
          Загрузка эмодзи…
        </p>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {query.trim() ? (
              results.length > 0 ? (
                <EmojiGrid title="Результаты" entries={results} onSelect={select} />
              ) : (
                <p className="px-3 py-6 text-center text-xs text-[#949ba4]">
                  Ничего не найдено
                </p>
              )
            ) : (
              <>
                {recentEntries.length > 0 && (
                  <div data-category="recent">
                    <EmojiGrid title="Часто используемые" entries={recentEntries} onSelect={select} />
                  </div>
                )}
                {categories.map((category) => (
                  <div key={category.id} data-category={category.id}>
                    <EmojiGrid
                      title={category.label}
                      entries={category.entries}
                      onSelect={select}
                    />
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="emoji-picker-categories flex items-center gap-0.5 overflow-x-auto border-t border-border px-2 py-1.5">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                title={category.label}
                aria-label={category.label}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-base transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => scrollToCategory(category)}
              >
                {category.icon}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
