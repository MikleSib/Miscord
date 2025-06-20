'use client'

import { useState } from 'react'
import { Hash, Volume2, ChevronDown, Settings, Plus } from 'lucide-react'
import { useStore } from '../lib/store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  TextField,
  Box,
} from '@mui/material'
import channelService from '../services/channelService'

export function ChannelSidebar() {
  const { currentServer, currentChannel, selectChannel, addChannel } = useStore()
  const [isCreateTextModalOpen, setIsCreateTextModalOpen] = useState(false)
  const [isCreateVoiceModalOpen, setIsCreateVoiceModalOpen] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleCreateTextChannel = async () => {
    if (!newChannelName.trim() || !currentServer) return

    setIsCreating(true)
    try {
      const newTextChannel = await channelService.createTextChannel(currentServer.id, {
        name: newChannelName,
        position: currentServer.channels.length,
      })

      const newChannel = {
        id: newTextChannel.id,
        name: newTextChannel.name,
        type: 'text' as const,
        serverId: currentServer.id,
      }

      addChannel(currentServer.id, newChannel)
      setIsCreateTextModalOpen(false)
      setNewChannelName('')
    } catch (error) {
      console.error('Ошибка создания текстового канала:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleCreateVoiceChannel = async () => {
    if (!newChannelName.trim() || !currentServer) return

    setIsCreating(true)
    try {
      const newVoiceChannel = await channelService.createVoiceChannel(currentServer.id, {
        name: newChannelName,
        position: currentServer.channels.length,
        max_users: 10,
      })

      const newChannel = {
        id: newVoiceChannel.id,
        name: newVoiceChannel.name,
        type: 'voice' as const,
        serverId: currentServer.id,
      }

      addChannel(currentServer.id, newChannel)
      setIsCreateVoiceModalOpen(false)
      setNewChannelName('')
    } catch (error) {
      console.error('Ошибка создания голосового канала:', error)
    } finally {
      setIsCreating(false)
    }
  }

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
    <>
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
                  <Plus 
                    className="w-4 h-4 cursor-pointer hover:text-foreground" 
                    onClick={() => setIsCreateTextModalOpen(true)}
                  />
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
                  <Plus 
                    className="w-4 h-4 cursor-pointer hover:text-foreground" 
                    onClick={() => setIsCreateVoiceModalOpen(true)}
                  />
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

      {/* Create Text Channel Modal */}
      <Dialog open={isCreateTextModalOpen} onClose={() => setIsCreateTextModalOpen(false)}>
        <DialogContent>
          <DialogTitle>Создать текстовый канал</DialogTitle>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Название канала"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              fullWidth
              required
            />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
              <Button
                variant="outline"
                onClick={() => setIsCreateTextModalOpen(false)}
                disabled={isCreating}
              >
                Отмена
              </Button>
              <Button
                onClick={handleCreateTextChannel}
                disabled={!newChannelName.trim() || isCreating}
              >
                {isCreating ? 'Создание...' : 'Создать'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Create Voice Channel Modal */}
      <Dialog open={isCreateVoiceModalOpen} onClose={() => setIsCreateVoiceModalOpen(false)}>
        <DialogContent>
          <DialogTitle>Создать голосовой канал</DialogTitle>
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Название канала"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              fullWidth
              required
            />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
              <Button
                variant="outline"
                onClick={() => setIsCreateVoiceModalOpen(false)}
                disabled={isCreating}
              >
                Отмена
              </Button>
              <Button
                onClick={handleCreateVoiceChannel}
                disabled={!newChannelName.trim() || isCreating}
              >
                {isCreating ? 'Создание...' : 'Создать'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  )
}