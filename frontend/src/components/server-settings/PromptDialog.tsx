'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { TextInput } from './layout'

interface PromptDialogProps {
  open: boolean
  title: string
  description?: React.ReactNode
  label: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  pendingLabel?: string
  isPending?: boolean
  error?: string
  allowEmpty?: boolean
  maxLength?: number
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'Сохранить',
  pendingLabel = 'Сохранение...',
  isPending = false,
  error,
  allowEmpty = true,
  maxLength = 200,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  if (!open) return null

  const canConfirm = allowEmpty || value.trim().length > 0

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={isPending ? undefined : onCancel} />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
        <h3 className="mb-2 text-lg font-semibold">{title}</h3>
        {description && <div className="mb-4 text-sm text-muted-foreground">{description}</div>}

        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </label>
        <TextInput
          autoFocus
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={isPending}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canConfirm && !isPending) {
              onConfirm(value)
            }
          }}
        />

        {error && (
          <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Отмена
          </Button>
          <Button onClick={() => onConfirm(value)} disabled={isPending || !canConfirm}>
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
