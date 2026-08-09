'use client'

import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { MODAL_Z_INDEX } from './modal'

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  onClose: () => void
  className?: string
  children: React.ReactNode
}

export function ContextMenu({ open, x, y, onClose, className, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const maxWidth = 280
  const left = Math.min(x, window.innerWidth - maxWidth - 8)
  const top = Math.min(y, window.innerHeight - 16)

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={cn(
        'fixed min-w-[220px] max-w-[280px] overflow-hidden rounded-panel border border-border bg-surface py-1 shadow-xl',
        className
      )}
      style={{ left, top, zIndex: MODAL_Z_INDEX.nested }}
    >
      {children}
    </div>,
    document.body
  )
}

export function ContextMenuItem({
  children,
  onClick,
  disabled,
  danger,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40',
        danger && 'text-destructive hover:bg-destructive/10',
        className
      )}
    >
      {children}
    </button>
  )
}

export function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />
}
