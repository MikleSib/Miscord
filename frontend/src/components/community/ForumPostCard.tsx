'use client'

import { Archive, Lock, MessageSquare as MessageSquareText, Users } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import { cn } from '../../lib/utils'
import type { ForumPostSummary, ForumTag } from '../../types/community'
import { UserAvatar } from '../ui/user-avatar'

interface ForumPostCardProps {
  post: ForumPostSummary
  tags: Map<number, ForumTag>
  layout: 'list' | 'gallery'
  onOpen: () => void
}

function activityLabel(post: ForumPostSummary) {
  const timestamp = post.last_message_at || post.created_at
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: ru })
}

export function ForumPostCard({ post, tags, layout, onOpen }: ForumPostCardProps) {
  const replies = Math.max(0, post.message_count - 1)
  const authorName = post.owner?.display_name || post.owner?.username || 'Участник'

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Открыть публикацию «${post.name}»`}
      className={cn(
        'group w-full border border-border bg-surface text-left outline-none transition-colors hover:border-border-control hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-primary',
        layout === 'gallery'
          ? 'flex min-h-52 flex-col rounded-xl p-4'
          : 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 rounded-lg px-4 py-3.5',
      )}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-canvas-deep text-text-quiet group-hover:text-foreground">
          <MessageSquareText className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-foreground">{post.name}</span>
            {post.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-[#f0b232]" aria-label="Заблокировано" />}
            {post.archived_at && <Archive className="h-3.5 w-3.5 shrink-0 text-text-quiet" aria-label="В архиве" />}
          </span>
          {post.preview && (
            <span className={cn('mt-1 block text-sm leading-5 text-text-quiet', layout === 'gallery' ? 'line-clamp-3' : 'line-clamp-2')}>
              {post.preview}
            </span>
          )}
        </span>
      </span>

      <span className={cn('flex shrink-0 items-center gap-3 text-xs text-text-quiet', layout === 'gallery' ? 'mt-auto pt-4' : 'row-span-2 self-center')}>
        <span className="inline-flex items-center gap-1" title={`${replies} ответов`}>
          <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
          {replies}
        </span>
        <span className="inline-flex items-center gap-1" title={`${post.member_count} участников`}>
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {post.member_count}
        </span>
      </span>

      <span className={cn('flex min-w-0 flex-wrap items-center gap-1.5', layout === 'gallery' ? 'mt-3' : 'col-start-1')}>
        <span className="mr-1 inline-flex min-w-0 items-center gap-1.5 text-xs text-text-quiet">
          <UserAvatar user={post.owner || undefined} size={20} />
          <span className="max-w-32 truncate">{authorName}</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap">{activityLabel(post)}</span>
        </span>
        {post.tag_ids?.map((id) => {
          const tag = tags.get(id)
          if (!tag) return null
          return (
            <span key={id} className="max-w-40 truncate rounded-full bg-canvas-deep px-2 py-0.5 text-[11px] font-medium text-text-body">
              {tag.emoji ? `${tag.emoji} ` : ''}{tag.name}
            </span>
          )
        })}
      </span>
    </button>
  )
}
