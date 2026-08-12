'use client'

import { useEffect, useRef, useState } from 'react'
import { Keyboard } from 'lucide-react'
import {
  combinationFromKeyboardEvent,
  formatCombination,
  type HotkeyCombination,
} from '../../lib/hotkeys'
import { cn } from '../../lib/utils'

interface HotkeyRecorderProps {
  value: HotkeyCombination | null
  onChange: (value: HotkeyCombination | null) => void
}

export function HotkeyRecorder({ value, onChange }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.code === 'Escape') {
        setRecording(false)
        buttonRef.current?.focus()
        return
      }
      if (event.code === 'Backspace' || event.code === 'Delete') {
        onChange(null)
        setRecording(false)
        buttonRef.current?.focus()
        return
      }
      const combination = combinationFromKeyboardEvent(event)
      if (!combination) return
      onChange(combination)
      setRecording(false)
      buttonRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onChange, recording])

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => setRecording(true)}
      aria-label={recording ? 'Введите сочетание клавиш' : `Горячая клавиша: ${formatCombination(value)}`}
      className={cn(
        'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 text-left outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-primary/50',
        recording
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border-control bg-background text-foreground hover:border-muted-foreground',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate font-medium">
          {recording ? 'Нажмите сочетание…' : formatCombination(value)}
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {recording ? 'Esc — отмена' : 'Изменить'}
      </span>
    </button>
  )
}
