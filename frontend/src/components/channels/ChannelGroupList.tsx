'use client'

import { useState, type DragEvent, type ReactNode } from 'react'
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

interface DropSlot {
  groupKey: string
  index: number
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
  const [dropSlot, setDropSlot] = useState<DropSlot | null>(null)

  const dragOver = (event: DragEvent, groupKey: string) => {
    if (!draggingChannel) return
    event.preventDefault()
    onDropTargetChange(groupKey)
  }

  const dragOverChannel = (
    event: DragEvent<HTMLDivElement>,
    groupKey: string,
    channelIndex: number,
  ) => {
    if (!draggingChannel) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    const insertAfter = event.clientY >= bounds.top + bounds.height / 2
    setDropSlot({ groupKey, index: channelIndex + (insertAfter ? 1 : 0) })
    onDropTargetChange(groupKey)
  }

  const dropOnChannel = (
    event: DragEvent<HTMLDivElement>,
    categoryId: number | null,
    groupKey: string,
    channelIndex: number,
  ) => {
    if (!draggingChannel) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    const insertAfter = event.clientY >= bounds.top + bounds.height / 2
    setDropSlot(null)
    onDropTargetChange(null)
    onDropChannel(categoryId, channelIndex + (insertAfter ? 1 : 0))
  }

  const finishDrag = () => {
    setDropSlot(null)
    onDragEnd()
  }

  return (
    <>
      {groups.map((group) => {
        const categoryId = group.category?.id ?? null
        const groupKey = `${kind}:${categoryId ?? 'none'}`
        const collapsed =
          categoryId != null && Boolean(collapsedCategories[`${serverId}:${categoryId}`])

        const channels = group.channels.map((channel, channelIndex) => {
          const showLineBefore =
            dropSlot?.groupKey === groupKey && dropSlot.index === channelIndex
          const showLineAfter =
            channelIndex === group.channels.length - 1 &&
            dropSlot?.groupKey === groupKey &&
            dropSlot.index === group.channels.length

          return (
            <div
              key={`${kind}-${channel.id}`}
              className="relative"
              draggable={canManage && !isSearching}
              onDragStart={() => onDragStart(channel)}
              onDragEnd={finishDrag}
              onDragOver={(event) => dragOverChannel(event, groupKey, channelIndex)}
              onDrop={(event) =>
                dropOnChannel(event, categoryId, groupKey, channelIndex)
              }
            >
              {showLineBefore && (
                <span className="pointer-events-none absolute -top-0.5 inset-x-1 z-20 h-0.5 rounded-full bg-primary" />
              )}
              {renderChannel(channel)}
              {showLineAfter && (
                <span className="pointer-events-none absolute -bottom-0.5 inset-x-1 z-20 h-0.5 rounded-full bg-primary" />
              )}
            </div>
          )
        })

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
