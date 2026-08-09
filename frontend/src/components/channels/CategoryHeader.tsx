'use client'

import { useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ChannelCategory } from '../../services/categoryService'
import { Tooltip } from '../ui/tooltip'
import { cn } from '../../lib/utils'

interface CategoryHeaderProps {
  category: ChannelCategory
  collapsed: boolean
  canManage: boolean
  onToggle: () => void
  onCreateChannel: () => void
  onRename: (name: string) => void
  onDelete: () => void
  /** Подсветка при перетаскивании канала на заголовок. */
  isDropTarget?: boolean
  onDragOver?: (event: React.DragEvent) => void
  onDrop?: (event: React.DragEvent) => void
  onDragLeave?: () => void
}

export function CategoryHeader({
  category,
  collapsed,
  canManage,
  onToggle,
  onCreateChannel,
  onRename,
  onDelete,
  isDropTarget,
  onDragOver,
  onDrop,
  onDragLeave,
}: CategoryHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(category.name)

  const commit = () => {
    setIsEditing(false)
    const next = draft.trim()
    if (next && next !== category.name) onRename(next)
    else setDraft(category.name)
  }

  return (
    <div
      className={cn(
        'group/category mt-3 flex items-center justify-between rounded px-1 text-xs font-semibold uppercase text-muted-foreground',
        isDropTarget && 'bg-primary/15',
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      {isEditing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') {
              setDraft(category.name)
              setIsEditing(false)
            }
          }}
          maxLength={100}
          aria-label="Название категории"
          className="min-w-0 flex-1 rounded bg-canvas-deep px-1 py-0.5 text-xs uppercase text-foreground outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left transition-colors hover:text-foreground"
          aria-expanded={!collapsed}
        >
          <ChevronDown
            className={cn('h-3 w-3 shrink-0 transition-transform', collapsed && '-rotate-90')}
            aria-hidden="true"
          />
          <span className="truncate">{category.name}</span>
        </button>
      )}

      {canManage && !isEditing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/category:opacity-100">
          <Tooltip content="Переименовать">
            <button
              type="button"
              aria-label="Переименовать категорию"
              onClick={() => {
                setDraft(category.name)
                setIsEditing(true)
              }}
              className="rounded p-0.5 transition hover:bg-secondary/60 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Создать канал в категории">
            <button
              type="button"
              aria-label="Создать канал в категории"
              onClick={onCreateChannel}
              className="rounded p-0.5 transition hover:bg-secondary/60 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content="Удалить категорию">
            <button
              type="button"
              aria-label="Удалить категорию"
              onClick={onDelete}
              className="rounded p-0.5 transition hover:bg-secondary/60 hover:text-[#f23f43]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
