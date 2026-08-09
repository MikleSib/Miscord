'use client'

import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import type { ChannelGroup } from '../../lib/channelGrouping'
import type { Channel } from '../../types'
import { CategoryHeader } from './CategoryHeader'

interface ChannelGroupListProps {
  groups: ChannelGroup[]
  kind: 'text' | 'voice'
  serverId: number
  canManage: boolean
  /** Во время поиска перетаскивание отключено: порядок показан не полностью. */
  isSearching: boolean
  collapsedCategories: Record<string, boolean>
  draggingChannel: Channel | null
  dropCategoryKey: string | null
  onDragStart: (channel: Channel) => void
  onDragEnd: () => void
  onDropTargetChange: (key: string | null) => void
  onDropChannel: (categoryId: number | null, index: number) => void
  onToggleCategory: (categoryId: number) => void
  onCreateChannel: () => void
  onRenameCategory: (categoryId: number, name: string) => void
  onDeleteCategory: (categoryId: number, name: string) => void
  renderChannel: (channel: Channel) => ReactNode
}

export function ChannelGroupList({
  groups,
  kind,
  serverId,
  canManage,
  isSearching,
  collapsedCategories,
  draggingChannel,
  dropCategoryKey,
  onDragStart,
  onDragEnd,
  onDropTargetChange,
  onDropChannel,
  onToggleCategory,
  onCreateChannel,
  onRenameCategory,
  onDeleteCategory,
  renderChannel,
}: ChannelGroupListProps) {
  const dragOver = (event: React.DragEvent, groupKey: string) => {
    if (!draggingChannel) return
    event.preventDefault()
    onDropTargetChange(groupKey)
  }

  return (
    <>
      {groups.map((group) => {
        const categoryId = group.category?.id ?? null
        const groupKey = `${kind}:${categoryId ?? 'none'}`
        const collapsed =
          categoryId != null && Boolean(collapsedCategories[`${serverId}:${categoryId}`])

        const channels = group.channels.map((channel) => (
          <div
            key={`${kind}-${channel.id}`}
            draggable={canManage && !isSearching}
            onDragStart={() => onDragStart(channel)}
            onDragEnd={onDragEnd}
          >
            {renderChannel(channel)}
          </div>
        ))

        if (!group.category) {
          return (
            <div
              key={groupKey}
              className={cn('space-y-0.5', dropCategoryKey === groupKey && 'rounded bg-primary/10')}
              onDragOver={(event) => dragOver(event, groupKey)}
              onDragLeave={() => onDropTargetChange(null)}
              onDrop={() => onDropChannel(null, group.channels.length)}
            >
              {channels}
            </div>
          )
        }

        const category = group.category

        return (
          <div key={groupKey} className="space-y-0.5">
            <CategoryHeader
              category={category}
              collapsed={collapsed}
              canManage={canManage}
              isDropTarget={dropCategoryKey === groupKey}
              onToggle={() => onToggleCategory(category.id)}
              onCreateChannel={onCreateChannel}
              onRename={(name) => onRenameCategory(category.id, name)}
              onDelete={() => onDeleteCategory(category.id, category.name)}
              onDragOver={(event) => dragOver(event, groupKey)}
              onDragLeave={() => onDropTargetChange(null)}
              onDrop={() => onDropChannel(categoryId, 0)}
            />
            {!collapsed && (
              <div
                className={cn(
                  'space-y-0.5',
                  dropCategoryKey === groupKey && 'rounded bg-primary/10',
                )}
                onDragOver={(event) => dragOver(event, groupKey)}
                onDragLeave={() => onDropTargetChange(null)}
                onDrop={() => onDropChannel(categoryId, group.channels.length)}
              >
                {channels}
                {group.channels.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    Перетащите канал сюда
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
