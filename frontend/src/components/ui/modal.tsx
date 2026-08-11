'use client'

import React, { useId } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap'

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
  const autoTitleId = useId()
  const labelledBy = titleId || (title ? autoTitleId : undefined)
  const panelRef = useModalFocusTrap<HTMLDivElement>(open, () => {
    if (!disableClose) onClose()
  })

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={cn(
        'miscord-responsive-modal fixed inset-0 flex items-center justify-center p-4',
        className
      )}
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
          'miscord-responsive-modal-card relative w-full max-w-lg overflow-hidden rounded-media bg-surface-raised shadow-2xl outline-none',
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
