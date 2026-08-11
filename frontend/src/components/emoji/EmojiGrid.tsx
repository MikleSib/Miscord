'use client'

import type { EmojiEntry } from '../../lib/emoji'

interface EmojiGridProps {
  title: string
  entries: EmojiEntry[]
  onSelect: (char: string) => void
}

export function EmojiGrid({ title, entries, onSelect }: EmojiGridProps) {
  if (entries.length === 0) return null

  return (
    <section className="px-2 pb-2">
      <h4 className="sticky top-0 z-10 bg-surface-raised py-1 text-[11px] font-semibold uppercase tracking-wide text-text-quiet">
        {title}
      </h4>
      <div className="emoji-picker-grid grid grid-cols-9 gap-0.5">
        {entries.map(([char, name]) => (
          <button
            key={`${title}-${char}`}
            type="button"
            title={`:${name}:`}
            aria-label={name}
            className="grid h-11 w-11 place-items-center rounded-md text-xl leading-none transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => onSelect(char)}
          >
            {char}
          </button>
        ))}
      </div>
    </section>
  )
}
