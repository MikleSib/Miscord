'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  /** success = зелёный (по умолчанию), brand = синий Miscord */
  variant?: 'success' | 'brand'
}

/**
 * Фирменный переключатель: зелёный/синий «вкл», серый «выкл»,
 * белый кружок едет с лёгким пружинным отскоком.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
  variant = 'success',
}: SwitchProps) {
  const onColor = variant === 'brand' ? 'bg-primary' : 'bg-green-500'
  const ringColor =
    variant === 'brand' ? 'focus-visible:ring-[#5865f2]/50' : 'focus-visible:ring-[#23a559]/50'

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked)
      }}
      className={cn(
        'group relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center rounded-full outline-none',
        'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#313338]',
        ringColor,
        'disabled:cursor-not-allowed disabled:opacity-50',
        'motion-reduce:transition-none',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-1/2 h-6 w-11 -translate-y-1/2 rounded-full transition-colors duration-150 ease-out',
          checked ? onColor : 'bg-border-control group-hover:bg-[#585b64]',
          'motion-reduce:transition-none',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-white',
          'shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-out',
          'group-active:scale-[0.9] group-disabled:group-active:scale-100',
          'motion-reduce:transition-none motion-reduce:group-active:scale-100',
          checked ? 'translate-x-[23px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  )
}
