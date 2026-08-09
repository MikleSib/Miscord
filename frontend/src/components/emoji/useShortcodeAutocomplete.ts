'use client'

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  getActiveShortcodeQuery,
  replaceShortcode,
  searchEmoji,
  type EmojiEntry,
} from '../../lib/emoji'
import { resizeChatComposer } from '../../lib/chatComposer'
import { useEmojiData } from './useEmojiData'

const SUGGESTION_LIMIT = 8

/**
 * Автодополнение `:код` в поле ввода. Данные эмодзи подгружаются только
 * после того, как пользователь начал набирать двоеточие с текстом.
 */
export function useShortcodeAutocomplete(
  value: string,
  inputRef: RefObject<HTMLTextAreaElement | null>,
  setValue: (value: string) => void,
) {
  const [caret, setCaret] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const query = useMemo(
    () => getActiveShortcodeQuery(value, Math.min(caret, value.length)),
    [value, caret],
  )
  const { categories } = useEmojiData(query !== null)

  const entries = useMemo(() => {
    if (!query || !categories) return []
    return searchEmoji(categories, query.query, SUGGESTION_LIMIT)
  }, [categories, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query?.query])

  const apply = useCallback(
    (entry: EmojiEntry) => {
      if (!query) return
      const input = inputRef.current
      const currentCaret = input?.selectionStart ?? value.length
      const next = replaceShortcode(value, currentCaret, query.start, entry[0])
      setValue(next.value)

      requestAnimationFrame(() => {
        const element = inputRef.current
        if (!element) return
        element.focus()
        element.setSelectionRange(next.caret, next.caret)
        resizeChatComposer(element)
        setCaret(next.caret)
      })
    },
    [inputRef, query, setValue, value],
  )

  /** Возвращает true, если клавиша обработана списком подсказок. */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (entries.length === 0) return false

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((previous) => (previous + 1) % entries.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((previous) => (previous - 1 + entries.length) % entries.length)
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setCaret(-1)
        return true
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing)) {
        event.preventDefault()
        apply(entries[selectedIndex] ?? entries[0])
        return true
      }
      return false
    },
    [apply, entries, selectedIndex],
  )

  return {
    entries,
    selectedIndex,
    setSelectedIndex,
    syncCaret: setCaret,
    handleKeyDown,
    apply,
  }
}
