'use client'

import React, { useMemo } from 'react'
import { Check, Slash, X } from 'lucide-react'

import { cn } from '../../lib/utils'
import { hasRawPermission, permissionBitfield } from '../../lib/permissions'
import { ChannelPermissionCatalogItem } from '../../types'

export type OverwritePermissionState = 'inherit' | 'allow' | 'deny'

export function getOverwritePermissionState(
  allow: number,
  deny: number,
  bit: number
): OverwritePermissionState {
  if (hasRawPermission(allow, bit)) return 'allow'
  if (hasRawPermission(deny, bit)) return 'deny'
  return 'inherit'
}

export function setOverwritePermissionState(
  allow: number,
  deny: number,
  bit: number,
  state: OverwritePermissionState
): { allow: number; deny: number } {
  if (state === 'allow') {
    return {
      allow: Number(permissionBitfield(allow) | permissionBitfield(bit)),
      deny: Number(permissionBitfield(deny) & ~permissionBitfield(bit)),
    }
  }
  if (state === 'deny') {
    return {
      allow: Number(permissionBitfield(allow) & ~permissionBitfield(bit)),
      deny: Number(permissionBitfield(deny) | permissionBitfield(bit)),
    }
  }
  return {
    allow: Number(permissionBitfield(allow) & ~permissionBitfield(bit)),
    deny: Number(permissionBitfield(deny) & ~permissionBitfield(bit)),
  }
}

const GROUP_LABELS: Record<string, string> = {
  general: 'Основные права канала',
  members: 'Права участников',
  text: 'Права текстового канала',
  voice: 'Права голосового канала',
  other: 'Другие права',
}

const GROUP_ORDER = ['general', 'members', 'text', 'voice', 'other']

interface ChannelOverwriteEditorProps {
  permissions: ChannelPermissionCatalogItem[]
  allow: number
  deny: number
  disabled?: boolean
  onChange: (next: { allow: number; deny: number }) => void
}

export function ChannelOverwriteEditor({
  permissions,
  allow,
  deny,
  disabled = false,
  onChange,
}: ChannelOverwriteEditorProps) {
  const sections = useMemo(() => {
    const byGroup = new Map<string, ChannelPermissionCatalogItem[]>()
    for (const item of permissions) {
      const group = item.group || 'other'
      const list = byGroup.get(group) ?? []
      list.push(item)
      byGroup.set(group, list)
    }
    return GROUP_ORDER.filter((key) => byGroup.has(key)).map((key) => ({
      key,
      label: GROUP_LABELS[key] || key,
      items: byGroup.get(key)!,
    }))
  }, [permissions])

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <div key={section.key}>
          <h4 className="mb-1 text-[13px] font-bold text-white">{section.label}</h4>
          <div>
            {section.items.map((permission, index) => {
              const state = getOverwritePermissionState(allow, deny, permission.value)

              return (
                <div key={permission.key}>
                  <div className="channel-permission-row flex items-start justify-between gap-8 py-4">
                    <div className="min-w-0 max-w-[440px]">
                      <p className="text-[15px] font-semibold leading-5 text-white">
                        {permission.label}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-[#b5bac1]">
                        {permission.description}
                      </p>
                    </div>

                    <div className="channel-permission-state mt-0.5 flex shrink-0 items-center gap-0.5 rounded bg-[#1e1f22] p-0.5">
                      {(
                        [
                          {
                            value: 'deny' as const,
                            icon: X,
                            label: 'Запретить',
                            activeClass: 'text-[#f23f43]',
                          },
                          {
                            value: 'inherit' as const,
                            icon: Slash,
                            label: 'Наследовать',
                            activeClass: 'text-[#dbdee1]',
                          },
                          {
                            value: 'allow' as const,
                            icon: Check,
                            label: 'Разрешить',
                            activeClass: 'text-[#23a559]',
                          },
                        ] as const
                      ).map((option) => {
                        const Icon = option.icon
                        const active = state === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            disabled={disabled}
                            aria-label={`${permission.label}: ${option.label}`}
                            aria-pressed={active}
                            onClick={() =>
                              onChange(
                                setOverwritePermissionState(
                                  allow,
                                  deny,
                                  permission.value,
                                  option.value
                                )
                              )
                            }
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded transition',
                              active
                                ? `bg-[#2b2d31] ${option.activeClass}`
                                : 'text-[#4e5058] hover:text-[#b5bac1]',
                              disabled && 'cursor-not-allowed opacity-50'
                            )}
                          >
                            <Icon className="h-4 w-4" strokeWidth={2.5} />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {index < section.items.length - 1 && <div className="h-px bg-[#3f4147]" />}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
