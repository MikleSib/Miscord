'use client'

import React from 'react'
import { Button } from '../ui/button'

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
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={isPending ? undefined : onCancel} />
      <div className="relative bg-background border border-border p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
        <h3 className={danger ? 'text-lg font-semibold mb-4 text-red-500' : 'text-lg font-semibold mb-4'}>
          {title}
        </h3>
        <div className="text-sm text-muted-foreground mb-6">{description}</div>
        {error && (
          <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Отмена
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            className={danger ? 'bg-red-500 hover:bg-red-600 text-white' : undefined}
          >
            {isPending ? pendingLabel || 'Подождите...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
