'use client'

import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export const MODAL_Z_INDEX = {
  base: 110,
  nested: 120,
  toast: 130,
} as const

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  titleId?: string
  /** Не закрывать по клику на фон / Esc */
  disableClose?: boolean
  className?: string
  contentClassName?: string
  zIndex?: number
  children: React.ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  title,
  titleId,
  disableClose = false,
  className,
  contentClassName,
  zIndex = MODAL_Z_INDEX.base,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const autoTitleId = useId()
  const labelledBy = titleId || (title ? autoTitleId : undefined)

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE)
    focusables?.[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disableClose) {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1
      )
      if (nodes.length === 0) {
        event.preventDefault()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [open, onClose, disableClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={cn('fixed inset-0 flex items-center justify-center p-4', className)}
      style={{ zIndex }}
    >
      <div
        className="absolute inset-0 bg-black/70"
        onClick={() => {
          if (!disableClose) onClose()
        }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          'relative w-full max-w-lg overflow-hidden rounded-media bg-surface-raised shadow-2xl outline-none',
          contentClassName
        )}
      >
        {title && !titleId ? (
          <h2 id={labelledBy} className="sr-only">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>,
    document.body
  )
}
