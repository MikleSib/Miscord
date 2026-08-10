'use client'

import { UserAvatar } from '../ui/user-avatar'
import { cn } from '../../lib/utils'
import type { ChannelPermissionOverwrite } from '../../types'

function targetKey(targetType: string, targetId: number) {
  return `${targetType}:${targetId}`
}

export function ChannelPermissionTargetList({ model }: { model: any }) {
  const { sortedOverwrites, selected, setSelected, pending } = model
  return (
    <>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
                  {sortedOverwrites.map((item: ChannelPermissionOverwrite) => {
          const active =
            selected?.target_type === item.target_type &&
            selected?.target_id === item.target_id
          const dirty = Boolean(pending[targetKey(item.target_type, item.target_id)])
          return (
            <button
              key={`${item.target_type}-${item.target_id}`}
              type="button"
              onClick={() =>
                setSelected({
                  target_type: item.target_type,
                  target_id: item.target_id,
                })
              }
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition',
                active
                  ? 'bg-[#404249] text-white'
                  : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-[#dbdee1]'
              )}
            >
              {item.target_type === 'member' ? (
                <UserAvatar
                  user={{
                    username: item.target_name,
                    avatar_url: item.target_avatar_url,
                  }}
                  size={22}
                />
              ) : (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: item.target_color || '#949ba4' }}
                />
              )}
              <span
                className="truncate"
                style={
                  item.target_type === 'role' && item.target_color
                    ? { color: active ? undefined : item.target_color }
                    : undefined
                }
              >
                {item.target_name}
              </span>
              {dirty && (
                <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#00a8fc]" />
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
