'use client'

import { useCallback, type KeyboardEvent, type RefObject } from 'react'
import { toggleInlineMarker } from '../lib/markdown'
import { resizeChatComposer } from '../lib/chatComposer'

/** Ctrl/Cmd + клавиша → маркер разметки, как в Discord. */
const PLAIN_SHORTCUTS: Record<string, string> = {
  b: '**',
  i: '*',
  u: '__',
}

const SHIFT_SHORTCUTS: Record<string, string> = {
  x: '||',
  s: '~~',
  c: '`',
}

export type ComposerFormattingHandler = (
  event: KeyboardEvent<HTMLTextAreaElement>,
) => boolean

/**
 * Горячие клавиши разметки для поля ввода сообщения.
 * Возвращает обработчик: true — событие обработано, дальше его вести не нужно.
 */
export function useComposerFormatting(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  setValue: (value: string) => void,
): ComposerFormattingHandler {
  return useCallback(
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return false

      const key = event.key.toLowerCase()
      const marker = event.shiftKey ? SHIFT_SHORTCUTS[key] : PLAIN_SHORTCUTS[key]
      if (!marker) return false

      const input = inputRef.current
      if (!input) return false

      event.preventDefault()
      const next = toggleInlineMarker(
        input.value,
        input.selectionStart ?? input.value.length,
        input.selectionEnd ?? input.value.length,
        marker,
      )
      setValue(next.value)

      requestAnimationFrame(() => {
        const element = inputRef.current
        if (!element) return
        element.focus()
        element.setSelectionRange(next.selectionStart, next.selectionEnd)
        resizeChatComposer(element)
      })

      return true
    },
    [inputRef, setValue],
  )
}
