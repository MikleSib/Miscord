'use client'

import { useMemo } from 'react'
import { parseMessageMarkdown } from '../../lib/markdown'
import { cn } from '../../lib/utils'
import { MarkdownProvider } from './context'
import { MarkdownBlocks } from './MarkdownBlocks'

interface MarkdownContentProps {
  content: string
  currentUserId?: number
  resolveMentionLabel: (userId: number) => string
  onMentionClick?: (userId: number, anchorRect: DOMRect) => void
  className?: string
}

export function MarkdownContent({
  content,
  currentUserId,
  resolveMentionLabel,
  onMentionClick,
  className,
}: MarkdownContentProps) {
  const blocks = useMemo(() => parseMessageMarkdown(content), [content])
  const context = useMemo(
    () => ({ currentUserId, resolveMentionLabel, onMentionClick }),
    [currentUserId, resolveMentionLabel, onMentionClick],
  )

  if (blocks.length === 0) return null

  return (
    <div className={cn('message-markdown-content space-y-1 text-sm leading-relaxed', className)}>
      <MarkdownProvider value={context}>
        <MarkdownBlocks blocks={blocks} />
      </MarkdownProvider>
    </div>
  )
}
