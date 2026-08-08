'use client'

import React from 'react'
import { Lock } from 'lucide-react'

import { PermissionCatalog } from '../../types'
import { hasRawPermission, togglePermission } from '../../lib/permissions'
import { Switch } from '../ui/switch'

interface RolePermissionEditorProps {
  catalog: PermissionCatalog
  /** Текущая битовая маска роли. */
  value: number
  /** Права самого пользователя — то, чего нет у него, выдать нельзя. */
  ownPermissions: number
  disabled?: boolean
  onChange: (next: number) => void
}

/** Список переключателей прав, сгруппированный по разделам каталога. */
export function RolePermissionEditor({
  catalog,
  value,
  ownPermissions,
  disabled = false,
  onChange,
}: RolePermissionEditorProps) {
  const isAdministrator = hasRawPermission(ownPermissions, findAdministrator(catalog))

  return (
    <div className="space-y-6">
      {catalog.groups.map((group) => {
        const items = catalog.permissions.filter((item) => item.group === group.key)
        if (items.length === 0) return null

        return (
          <div key={group.key}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </h4>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {items.map((item) => {
                const enabled = hasRawPermission(value, item.value)
                // Право можно менять только если оно есть у самого пользователя
                const locked = disabled || (!isAdministrator && !hasRawPermission(ownPermissions, item.value))

                return (
                  <div
                    key={item.key}
                    className="flex items-start justify-between gap-4 bg-secondary/30 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {item.label}
                        {locked && !disabled && (
                          <span title="У вас нет этого права, поэтому выдать его нельзя">
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
                    </div>

                    <Switch
                      className="mt-0.5"
                      checked={enabled}
                      disabled={locked}
                      aria-label={item.label}
                      onCheckedChange={(next) =>
                        onChange(togglePermission(value, item.value, next))
                      }
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function findAdministrator(catalog: PermissionCatalog): number {
  return catalog.permissions.find((item) => item.key === 'ADMINISTRATOR')?.value ?? 0
}
