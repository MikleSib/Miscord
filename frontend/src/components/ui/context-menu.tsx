'use client'

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const updatePosition = () => {
      const bounds = ref.current?.getBoundingClientRect()
      if (!bounds) return
      const padding = 8
      setPosition({
        left: Math.max(padding, Math.min(x, window.innerWidth - bounds.width - padding)),
        top: Math.max(padding, Math.min(y, window.innerHeight - bounds.height - padding)),
      })
    }
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [open, x, y])

  useEffect(() => {
    if (!open || !ref.current) return
    const firstItem = ref.current.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')
    firstItem?.focus({ preventScroll: true })
  }, [open, x, y])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !ref.current) return
      if (!(event.target as HTMLElement | null)?.closest('[role="menuitem"]')) return
      const items = [...ref.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')]
      if (!items.length) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length
      items[next]?.focus()
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

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={cn(
        'fixed min-w-[220px] max-w-[300px] overflow-x-hidden overflow-y-auto rounded-panel border border-border bg-surface py-1 shadow-xl outline-none',
        className
      )}
      style={{
        left: position.left,
        top: position.top,
        maxHeight: 'calc(100vh - 16px)',
        zIndex: MODAL_Z_INDEX.nested,
      }}
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
