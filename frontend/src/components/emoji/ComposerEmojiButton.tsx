'use client'

import { useState, type RefObject } from 'react'
import { Smile } from 'lucide-react'
import { insertEmojiAtCaret } from '../../lib/emoji'
import { resizeChatComposer } from '../../lib/chatComposer'
import { cn } from '../../lib/utils'
import { EmojiPickerPopover } from './EmojiPickerPopover'

interface ComposerEmojiButtonProps {
  inputRef: RefObject<HTMLTextAreaElement | null>
  setValue: (value: string) => void
  disabled?: boolean
  className?: string
}

/** Кнопка эмодзи в поле ввода: вставляет символ на позицию курсора. */
export function ComposerEmojiButton({
  inputRef,
  setValue,
  disabled,
  className,
}: ComposerEmojiButtonProps) {
  const [open, setOpen] = useState(false)

  const insert = (char: string) => {
    const input = inputRef.current
    const value = input?.value ?? ''
    const next = insertEmojiAtCaret(
      value,
      input?.selectionStart ?? value.length,
      input?.selectionEnd ?? value.length,
      char,
    )
    setValue(next.value)

    requestAnimationFrame(() => {
      const element = inputRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(next.caret, next.caret)
      resizeChatComposer(element)
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label="Эмодзи"
        title="Эмодзи"
        onClick={() => setOpen((previous) => !previous)}
        className={cn(
          'grid h-11 w-11 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-white disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <Smile className="h-5 w-5" />
      </button>
      <EmojiPickerPopover
        open={open}
        onClose={() => setOpen(false)}
        onSelect={insert}
        keepOpenOnSelect
        className="bottom-9 right-0"
      />
    </div>
  )
}
