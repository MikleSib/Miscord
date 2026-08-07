'use client'

import { MentionCandidate } from '../lib/mentions'
import { UserAvatar } from './ui/user-avatar'
import { cn } from '../lib/utils'
import { resolveMediaUrl } from '../lib/mediaUrl'

interface MentionAutocompleteProps {
  candidates: MentionCandidate[]
  selectedIndex: number
  onSelect: (candidate: MentionCandidate) => void
  onHover: (index: number) => void
}

export function MentionAutocomplete({
  candidates,
  selectedIndex,
  onSelect,
  onHover,
}: MentionAutocompleteProps) {
  if (candidates.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-lg border border-[#3e3f45] bg-[#2b2d31] shadow-xl"
      role="listbox"
      aria-label="Упоминания участников"
    >
      <div className="border-b border-[#3e3f45] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#b5bac1]">
        Участники канала
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {candidates.map((candidate, index) => (
          <li key={candidate.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                index === selectedIndex ? 'bg-[#404249]' : 'hover:bg-[#35373c]'
              )}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                // Чтобы клик не уводил фокус с инпута до вставки
                event.preventDefault()
                onSelect(candidate)
              }}
            >
              <div className="relative flex-none">
                <UserAvatar
                  user={{
                    username: candidate.username,
                    display_name: candidate.displayName,
                    avatar_url: resolveMediaUrl(candidate.avatar_url) || undefined,
                  }}
                  size={28}
                />
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#2b2d31]',
                    candidate.is_online ? 'bg-green-500' : 'bg-[#747f8d]'
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-medium text-[#f2f3f5]"
                  style={candidate.color ? { color: candidate.color } : undefined}
                >
                  {candidate.displayName}
                </div>
                {candidate.displayName !== candidate.username && (
                  <div className="truncate text-xs text-[#949ba4]">@{candidate.username}</div>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
