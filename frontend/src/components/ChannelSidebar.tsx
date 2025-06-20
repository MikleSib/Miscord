'use client'

import { Hash, Volume2, ChevronDown, Settings, Plus } from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function ChannelSidebar() {
  const { currentServer, currentChannel, selectChannel } = useStore()

  if (!currentServer) {
    return (
      <div className="w-60 bg-secondary flex flex-col">
        <div className="h-12 px-4 flex items-center border-b border-border">
          <span className="font-semibold">Выберите сервер</span>
        </div>
      </div>
    )
  }

  const textChannels = currentServer.channels.filter(c => c.type === 'text')
  const voiceChannels = currentServer.channels.filter(c => c.type === 'voice')

  return (
    <div className="w-60 bg-secondary flex flex-col">
      {/* Server Header */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-border cursor-pointer hover:bg-accent/50">
        <span className="font-semibold">{currentServer.name}</span>
        <ChevronDown className="w-4 h-4" />
      </div>

      {/* Channels List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Text Channels */}
        {textChannels.length > 0 && (
          <div className="pt-4">
            <div className="px-2 mb-1">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Текстовые каналы</span>
                <Plus className="w-4 h-4 cursor-pointer hover:text-foreground" />
              </div>
            </div>
            <div className="px-2 space-y-0.5">
              {textChannels.map((channel) => (
                <Button
                  key={channel.id}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "w-full justify-start gap-1.5 h-8 px-2",
                    currentChannel?.id === channel.id && "bg-accent"
                  )}
                  onClick={() => selectChannel(channel.id)}
                >
                  <Hash className="w-4 h-4" />
                  <span>{channel.name}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Voice Channels */}
        {voiceChannels.length > 0 && (
          <div className="pt-4">
            <div className="px-2 mb-1">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Голосовые каналы</span>
                <Plus className="w-4 h-4 cursor-pointer hover:text-foreground" />
              </div>
            </div>
            <div className="px-2 space-y-0.5">
              {voiceChannels.map((channel) => (
                <Button
                  key={channel.id}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "w-full justify-start gap-1.5 h-8 px-2",
                    currentChannel?.id === channel.id && "bg-accent"
                  )}
                  onClick={() => selectChannel(channel.id)}
                >
                  <Volume2 className="w-4 h-4" />
                  <span>{channel.name}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Panel */}
      <div className="h-[52px] bg-background/50 px-2 flex items-center justify-between">
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Settings className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}