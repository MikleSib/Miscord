'use client'

import { useState } from 'react'
import { Music2 } from 'lucide-react'

import { useCapabilities } from '../../features/capabilities/capabilities'
import { SoundboardLibraryDialog } from './SoundboardLibraryDialog'

export function SoundboardPanel({
  serverId,
  channelId,
  disabled,
}: {
  serverId: number
  channelId: number
  disabled?: boolean
}) {
  const capabilities = useCapabilities()
  const [open, setOpen] = useState(false)

  if (!capabilities.soundboard) return null
  return (
    <div className="relative flex-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`voice-control h-11 w-full ${open ? 'is-active' : ''}`}
        aria-label="Звуковая панель"
        aria-expanded={open}
      >
        <Music2 className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <SoundboardLibraryDialog
          serverId={serverId}
          channelId={channelId}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
