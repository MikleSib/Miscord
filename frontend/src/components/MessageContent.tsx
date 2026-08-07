'use client'

import { splitMessageMentions } from '../lib/mentions'
import { splitTextWithLinks } from '../lib/linkify'
import { cn } from '../lib/utils'

interface MessageContentProps {
  content: string
  currentUserId?: number
  resolveMentionLabel: (userId: number) => string
  onMentionClick?: (userId: number, anchorRect: DOMRect) => void
  className?: string
}

function LinkifiedText({ text }: { text: string }) {
  const parts = splitTextWithLinks(text)
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          return <span key={index}>{part.value}</span>
        }
        return (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00a8fc] hover:underline break-all"
            onClick={(event) => event.stopPropagation()}
          >
            {part.value}
          </a>
        )
      })}
    </>
  )
}

export function MessageContent({
  content,
  currentUserId,
  resolveMentionLabel,
  onMentionClick,
  className,
}: MessageContentProps) {
  const segments = splitMessageMentions(content, resolveMentionLabel, currentUserId)

  return (
    <p className={cn('text-sm leading-relaxed whitespace-pre-wrap break-words', className)}>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <LinkifiedText key={index} text={segment.value} />
        }

        return (
          <button
            key={index}
            type="button"
            className={cn(
              'rounded px-0.5 font-medium align-baseline cursor-pointer',
              segment.isSelf
                ? 'bg-[#5865f2] text-white hover:bg-[#4752c4]'
                : 'bg-[#5865f2]/30 text-[#c9cdfb] hover:bg-[#5865f2]/45'
            )}
            title={`Профиль: ${segment.label}`}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onMentionClick?.(segment.userId, event.currentTarget.getBoundingClientRect())
            }}
          >
            @{segment.label}
          </button>
        )
      })}
    </p>
  )
}
