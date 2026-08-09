'use client'

import { useEffect, useRef } from 'react'
import { cn } from '../../lib/utils'
import { EmojiPicker } from './EmojiPicker'

interface EmojiPickerPopoverProps {
  open: boolean
  onClose: () => void
  onSelect: (char: string) => void
  keepOpenOnSelect?: boolean
  /** Позиционирование относительно родителя с position: relative. */
  className?: string
}

export function EmojiPickerPopover({
  open,
  onClose,
  onSelect,
  keepOpenOnSelect,
  className,
}: EmojiPickerPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

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
  }, [open, onClose])

  if (!open) return null

  return (
    <div ref={containerRef} className={cn('absolute z-50', className)}>
      <EmojiPicker onSelect={onSelect} onClose={onClose} keepOpenOnSelect={keepOpenOnSelect} />
    </div>
  )
}
