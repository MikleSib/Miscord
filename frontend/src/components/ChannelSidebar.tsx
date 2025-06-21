'use client'

import { useState } from 'react'
import { Hash, Volume2, ChevronDown, Settings, Plus, Mic, MicOff, Headphones, PhoneOff, VolumeX, Monitor } from 'lucide-react'
import { useStore } from '../lib/store'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { useAuthStore } from '../store/store'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  TextField,
  Box,
  Avatar,
  Typography,
} from '@mui/material'
import channelService from '../services/channelService'

export function ChannelSidebar() {
  const { currentServer, currentChannel, selectChannel, addChannel } = useStore()
  const { 
    connectToVoiceChannel, 
    currentVoiceChannelId, 
    participants, 
    disconnectFromVoiceChannel, 
    isMuted, 
    isDeafened,
    isConnected,
    toggleMute,
    toggleDeafen
  } = useVoiceStore()
  const { user } = useAuthStore()
  const [isCreateTextModalOpen, setIsCreateTextModalOpen] = useState(false)
  const [isCreateVoiceModalOpen, setIsCreateVoiceModalOpen] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleChannelClick = async (channel: any) => {
    console.log('🔄 Клик по каналу:', channel.name, 'тип:', channel.type, 'ID:', channel.id);
    
    if (channel.type === 'voice') {
      // Подключаемся к голосовому каналу
      try {
        console.log('🎙️ Начинаем подключение к голосовому каналу');
        await connectToVoiceChannel(channel.id);
        selectChannel(channel.id);
        console.log('🎙️ Подключение завершено успешно');
      } catch (error) {
        console.error('🎙️ Ошибка подключения к голосовому каналу:', error);
      }
    } else {
      // Для текстовых каналов просто выбираем
      selectChannel(channel.id);
    }
  }

  // Функция для получения участников конкретного голосового канала
  const getChannelParticipants = (channelId: number) => {
    if (currentVoiceChannelId === channelId) {
      // Если это текущий канал, показываем всех участников включая текущего пользователя
      const currentUserParticipant = participants.find(p => p.user_id === user?.id);
      const allParticipants = [
        ...(user ? [{
          user_id: user.id,
          username: user.username,
          is_muted: currentUserParticipant?.is_muted ?? false,
          is_deafened: currentUserParticipant?.is_deafened ?? false,
        }] : []),
        ...participants.filter(p => p.user_id !== user?.id),
      ];
      return allParticipants;
    }
    return []; // Для других каналов пока показываем пустой список
  }

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
                  onClick={() => handleChannelClick(channel)}
                >
                  <Hash className="w-4 h-4" />
                  <span>{channel.name}</span>
                </Button>
              ))}
              {textChannels.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Нет текстовых каналов
                </div>
              )}
            </div>
          </div>

          {/* Voice Channels */}
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
              {voiceChannels.map((channel) => {
                const channelParticipants = getChannelParticipants(channel.id);
                return (
                  <div key={channel.id}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "w-full justify-start gap-1.5 h-8 px-2",
                        currentChannel?.id === channel.id && "bg-accent",
                        currentVoiceChannelId === channel.id && "bg-green-600/20 border border-green-500/50"
                      )}
                      onClick={() => handleChannelClick(channel)}
                    >
                      <Volume2 className={cn(
                        "w-4 h-4",
                        currentVoiceChannelId === channel.id && "text-green-400"
                      )} />
                      <span className={cn(
                        currentVoiceChannelId === channel.id && "text-green-400"
                      )}>
                        {channel.name}
                      </span>
                      {currentVoiceChannelId === channel.id && (
                        <div className="ml-auto w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                      )}
                    </Button>
                    
                    {/* Участники голосового канала */}
                    {channelParticipants.length > 0 && (
                      <div className="ml-6 mt-1 space-y-1">
                        {channelParticipants.map((participant) => (
                          <div
                            key={participant.user_id}
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 transition-colors"
                          >
                            <Avatar sx={{ width: 20, height: 20, fontSize: '10px' }}>
                              {participant.username[0].toUpperCase()}
                            </Avatar>
                            <Typography
                              variant="caption"
                              className={cn(
                                "flex-1 text-xs",
                                participant.is_deafened ? "text-red-400 line-through" : "text-muted-foreground"
                              )}
                            >
                              {participant.username}
                              {participant.user_id === user?.id && " (Вы)"}
                            </Typography>
                            <div className="flex gap-1">
                              {participant.is_muted && (
                                <MicOff className="w-3 h-3 text-red-400" />
                              )}
                              {participant.is_deafened && (
                                <Headphones className="w-3 h-3 text-red-400" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {voiceChannels.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Нет голосовых каналов
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Панель управления голосом в самом низу */}
        {isConnected && currentVoiceChannelId && (
          <div className="mt-auto border-t border-border/50 bg-accent/10 p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-green-400 truncate">
                  Голосовое подключение
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {currentServer?.channels.find(c => c.id === currentVoiceChannelId)?.name || 'Голосовой канал'}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-red-400"
                onClick={() => {
                  disconnectFromVoiceChannel();
                }}
                title="Отключиться"
              >
                <PhoneOff className="w-3 h-3" />
              </Button>
            </div>
            
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0",
                  isMuted 
                    ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" 
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
                onClick={toggleMute}
                title={isMuted ? 'Включить микрофон' : 'Отключить микрофон'}
              >
                {isMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0",
                  isDeafened 
                    ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" 
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
                onClick={toggleDeafen}
                title={isDeafened ? 'Включить звук' : 'Отключить звук'}
              >
                {isDeafened ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                title="Демонстрация экрана"
              >
                <Monitor className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Модальное окно создания текстового канала */}
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