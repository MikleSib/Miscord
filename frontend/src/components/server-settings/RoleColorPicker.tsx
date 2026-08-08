'use client'

import React from 'react'
import { Check, Ban } from 'lucide-react'

import { cn } from '../../lib/utils'

/** Палитра цветов ролей Miscord. */
export const ROLE_COLORS = [
  '#1abc9c',
  '#2ecc71',
  '#3498db',
  '#9b59b6',
  '#e91e63',
  '#f1c40f',
  '#e67e22',
  '#e74c3c',
  '#95a5a6',
  '#607d8b',
  '#11806a',
  '#1f8b4c',
  '#206694',
  '#71368a',
  '#ad1457',
  '#c27c0e',
  '#a84300',
  '#992d22',
  '#979c9f',
  '#546e7a',
]

interface RoleColorPickerProps {
  value: string | null
  disabled?: boolean
  onChange: (color: string | null) => void
}

export function RoleColorPicker({ value, disabled = false, onChange }: RoleColorPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        title="Без цвета"
        aria-label="Без цвета"
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded border border-border bg-secondary text-muted-foreground transition-transform',
          !value && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:scale-110'
        )}
      >
        <Ban className="h-3.5 w-3.5" />
      </button>

      {ROLE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          aria-label={`Цвет ${color}`}
          disabled={disabled}
          onClick={() => onChange(color)}
          style={{ backgroundColor: color }}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded transition-transform',
            value?.toLowerCase() === color.toLowerCase() &&
              'ring-2 ring-primary ring-offset-2 ring-offset-background',
            disabled ? 'cursor-not-allowed opacity-50' : 'hover:scale-110'
          )}
        >
          {value?.toLowerCase() === color.toLowerCase() && (
            <Check className="h-4 w-4 text-white" />
          )}
        </button>
      ))}

      <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
        Свой цвет
        <input
          type="color"
          value={value || '#5865f2'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
    </div>
  )
}
