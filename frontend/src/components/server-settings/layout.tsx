'use client'

import React from 'react'
import { cn } from '../../lib/utils'

/** Стандартная раскладка вкладки: прокручиваемое тело + закреплённая полоса действий. */
export function TabShell({
  children,
  footer,
  className,
}: {
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('scrollbar-thin flex-1 overflow-y-auto px-6 py-5', className)}>
        {children}
      </div>
      {footer && (
        <div className="flex-none border-t border-border bg-secondary/50 px-6 py-3">{footer}</div>
      )}
    </div>
  )
}

export function Section({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('mb-8 last:mb-0', className)}>
      {title && (
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      )}
      {description && <p className="mb-3 text-sm text-muted-foreground">{description}</p>}
      {children}
    </section>
  )
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </label>
  )
}

export function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground',
        'placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
    />
  )
}

export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
      {message}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {Icon && <Icon className="mb-3 h-8 w-8 text-muted-foreground" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

/** Переключатель в стиле Discord. */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label: string
  description?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-secondary/40 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
          disabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-4 w-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </button>
    </div>
  )
}
