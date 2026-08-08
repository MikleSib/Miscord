'use client'

import React from 'react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

interface UnsavedChangesBarProps {
  visible: boolean
  isSaving?: boolean
  onReset: () => void
  onSave: () => void
  className?: string
}

/** Нижняя панель Miscord: выезжает снизу вверх при несохранённых изменениях. */
export function UnsavedChangesBar({
  visible,
  isSaving = false,
  onReset,
  onSave,
  className,
}: UnsavedChangesBarProps) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-6 left-1/2 z-30 w-[min(740px,calc(100%-2rem))] -translate-x-1/2 transition-all duration-300 ease-out',
        visible
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'translate-y-10 opacity-0',
        className
      )}
      aria-hidden={!visible}
    >
      <div className="flex items-center justify-between gap-4 rounded-lg bg-[#111214] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
        <p className="text-sm font-medium text-[#f2f3f5]">
          Аккуратнее, вы не сохранили изменения!
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            disabled={isSaving || !visible}
            className="text-sm font-medium text-[#00a8fc] transition hover:underline disabled:opacity-50"
          >
            Сброс
          </button>
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onSave()
            }}
            disabled={isSaving || !visible}
            className="h-9 bg-[#248046] px-4 text-sm text-white hover:bg-[#1a6334]"
          >
            {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
          </Button>
        </div>
      </div>
    </div>
  )
}
