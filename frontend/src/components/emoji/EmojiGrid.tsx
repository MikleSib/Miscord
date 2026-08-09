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
      <h4 className="sticky top-0 z-10 bg-[#2b2d31] py-1 text-[11px] font-semibold uppercase tracking-wide text-[#949ba4]">
        {title}
      </h4>
      <div className="grid grid-cols-9 gap-0.5">
        {entries.map(([char, name]) => (
          <button
            key={`${title}-${char}`}
            type="button"
            title={`:${name}:`}
            aria-label={name}
            className="grid h-8 w-8 place-items-center rounded text-xl leading-none transition-colors hover:bg-[#ffffff14] focus-visible:bg-[#ffffff14] focus-visible:outline-none"
            onClick={() => onSelect(char)}
          >
            {char}
          </button>
        ))}
      </div>
    </section>
  )
}
