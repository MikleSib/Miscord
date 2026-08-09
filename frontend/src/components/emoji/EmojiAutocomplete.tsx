'use client'

import type { EmojiEntry } from '../../lib/emoji'
import { cn } from '../../lib/utils'

interface EmojiAutocompleteProps {
  entries: EmojiEntry[]
  selectedIndex: number
  onSelect: (entry: EmojiEntry) => void
  onHover: (index: number) => void
}

export function EmojiAutocomplete({
  entries,
  selectedIndex,
  onSelect,
  onHover,
}: EmojiAutocompleteProps) {
  if (entries.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-lg border border-[#3e3f45] bg-[#2b2d31] shadow-xl"
      role="listbox"
      aria-label="Эмодзи"
    >
      <div className="border-b border-[#3e3f45] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#b5bac1]">
        Эмодзи
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {entries.map((entry, index) => (
          <li key={entry[0]}>
            <button
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                index === selectedIndex ? 'bg-[#404249]' : 'hover:bg-[#35373c]',
              )}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(entry)
              }}
            >
              <span className="text-xl leading-none">{entry[0]}</span>
              <span className="truncate text-sm text-[#dbdee1]">:{entry[1]}:</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
