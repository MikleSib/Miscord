'use client'

import React from 'react'
import { Button } from '../ui/button'
import { Modal, MODAL_Z_INDEX } from '../ui/modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel: string
  pendingLabel?: string
  isPending?: boolean
  danger?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  isPending = false,
  danger = true,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      disableClose={isPending}
      zIndex={MODAL_Z_INDEX.nested}
      contentClassName="max-w-md border border-border bg-background p-6"
    >
      <h3 className={danger ? 'mb-4 text-lg font-semibold text-destructive' : 'mb-4 text-lg font-semibold'}>
        {title}
      </h3>
      <div className="mb-6 text-sm text-muted-foreground">{description}</div>
      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Отмена
        </Button>
        <Button
          onClick={onConfirm}
          disabled={isPending}
          className={danger ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
        >
          {isPending ? pendingLabel || 'Подождите...' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
