'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

interface DropdownProps {
  /** Кнопка-триггер. Получает текущее состояние, чтобы подсветить себя. */
  trigger: (state: { open: boolean }) => React.ReactNode
  children: (helpers: { close: () => void }) => React.ReactNode
  align?: 'left' | 'right'
  className?: string
  contentClassName?: string
}

const MENU_Z_INDEX = 110

export function Dropdown({
  trigger,
  children,
  align = 'right',
  className,
  contentClassName,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  const updatePosition = useCallback(() => {
    const triggerEl = containerRef.current
    const menuEl = menuRef.current
    if (!triggerEl) return

    const rect = triggerEl.getBoundingClientRect()
    const menuWidth = menuEl?.offsetWidth ?? 200
    const menuHeight = menuEl?.offsetHeight ?? 0
    const gap = 4

    let left = align === 'right' ? rect.right - menuWidth : rect.left
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8))

    let top = rect.bottom + gap
    if (menuHeight && top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuHeight - gap)
    }

    setMenuStyle({ top, left })
  }, [align])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }

    const handleReposition = () => updatePosition()

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape, true)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape, true)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open, updatePosition])

  const menu =
    open && mounted
      ? createPortal(
          <div
            ref={menuRef}
            style={{ ...menuStyle, zIndex: MENU_Z_INDEX }}
            className={cn(
              'fixed min-w-[200px] max-h-64 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-xl',
              contentClassName
            )}
          >
            {children({ close: () => setOpen(false) })}
          </div>,
          document.body
        )
      : null

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div onClick={() => setOpen((value) => !value)}>{trigger({ open })}</div>
      {menu}
    </div>
  )
}

export function DropdownItem({
  children,
  onClick,
  danger,
  disabled,
  icon: Icon,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-foreground hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
      )}
    >
      {Icon && <Icon className="h-4 w-4 flex-none" />}
      <span className="truncate">{children}</span>
    </button>
  )
}
