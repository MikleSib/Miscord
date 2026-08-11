'use client'

import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { UserAvatar } from '../ui/user-avatar'

interface TargetOption { kind: 'role' | 'member'; id: number; name: string; color?: string | null; avatar?: string | null }

export function ChannelPermissionTargetMenu({ model }: { model: any }) {
  const {
    showAddMenu, addMenuPos, addMenuRef, addQuery, setAddQuery,
    filteredAddOptions, handleAddTarget,
  } = model
  return (
    <>
      {showAddMenu &&
        addMenuPos &&
        createPortal(
          <div
            ref={addMenuRef}
            style={{ top: addMenuPos.top, left: addMenuPos.left }}
            className="channel-permission-target-menu fixed z-[120] w-72 overflow-hidden rounded-lg border border-[#1e1f22] bg-[#111214] shadow-2xl"
          >
            <div className="border-b border-[#1e1f22] px-3 py-2 text-sm font-semibold text-white">
              Добавить:
            </div>
            <div className="px-3 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#949ba4]" />
                <input
                  autoFocus
                  value={addQuery}
                  onChange={(event) => setAddQuery(event.target.value)}
                  placeholder="Роль/Участник"
                  className="w-full rounded border border-[#5865f2] bg-[#1e1f22] py-1.5 pl-8 pr-2 text-sm text-[#dbdee1] outline-none"
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {filteredAddOptions.length === 0 ? (
                <p className="px-3 py-2 text-sm text-[#949ba4]">Ничего не найдено</p>
              ) : (
                              filteredAddOptions.map((option: TargetOption) => (
                  <button
                    key={`${option.kind}-${option.id}`}
                    type="button"
                    onClick={() => void handleAddTarget(option.kind, option.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#2b2d31]"
                  >
                    {option.kind === 'role' ? (
                      <>
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: option.color || '#949ba4' }}
                        />
                        <span
                          className="min-w-0 flex-1 truncate font-medium"
                          style={{ color: option.color || '#f2f3f5' }}
                        >
                          {option.name}
                        </span>
                        <span className="text-xs text-[#949ba4]">Роль</span>
                      </>
                    ) : (
                      <>
                        <UserAvatar
                          user={{
                            username: option.name,
                            avatar_url: option.avatar,
                          }}
                          size={24}
                        />
                        <span className="truncate text-[#f2f3f5]">{option.name}</span>
                      </>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
