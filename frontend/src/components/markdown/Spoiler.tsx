'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)

  return (
    <span
      role="button"
      tabIndex={revealed ? -1 : 0}
      aria-label={revealed ? undefined : 'Показать скрытый текст'}
      className={cn(
        'rounded px-0.5 transition-colors',
        revealed
          ? 'bg-[#ffffff14]'
          : 'cursor-pointer select-none bg-[#202225] text-transparent hover:bg-[#2f3136]',
      )}
      onClick={(event) => {
        if (revealed) return
        event.stopPropagation()
        setRevealed(true)
      }}
      onKeyDown={(event) => {
        if (revealed || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        setRevealed(true)
      }}
    >
      {children}
    </span>
  )
}
