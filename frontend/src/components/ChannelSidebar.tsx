'use client'

import { useState, useEffect } from 'react'
import { Hash, Volume2, ChevronDown, Settings, Plus, Mic, MicOff, Headphones, PhoneOff, VolumeX, Monitor, UserX, UserCheck, Shield, Volume1 } from 'lucide-react'
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
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Slider,
  Paper,
} from '@mui/material'
import channelService from '../services/channelService'

// Компонент для аватарки с анимацией при разговоре
interface SpeakingAvatarProps {
  username: string;
  isSpeaking: boolean;
  size?: number;
}

function SpeakingAvatar({ username, isSpeaking, size = 20 }: SpeakingAvatarProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* Анимированная обводка */}
      {isSpeaking && (
        <Box
          sx={{
            position: 'absolute',
            top: -2,
            left: -2,
            width: size + 4,
            height: size + 4,
            borderRadius: '50%',
            background: 'linear-gradient(45deg, #00ff88, #00cc6a)',
            animation: 'speaking-pulse 1.5s ease-in-out infinite',
            '@keyframes speaking-pulse': {
              '0%': {
                transform: 'scale(1)',
                opacity: 0.8,
              },
              '50%': {
                transform: 'scale(1.1)',
                opacity: 1,
              },
              '100%': {
                transform: 'scale(1)',
                opacity: 0.8,
              },
            },
          }}
        />
      )}
      
      {/* Основная аватарка */}
      <Avatar 
        sx={{ 
          width: size, 
          height: size, 
          fontSize: `${size * 0.4}px`,
          backgroundColor: isSpeaking ? '#00ff88' : '#5865f2',
          color: 'white',
          fontWeight: 600,
          zIndex: 1,
          position: 'relative',
          border: isSpeaking ? '1px solid #00ff88' : '1px solid transparent',
          transition: 'all 0.2s ease-in-out',
        }}
      >
        {username[0].toUpperCase()}
      </Avatar>
    </Box>
  );
}

export function ChannelSidebar() {
  const { currentServer, currentChannel, selectChannel, addChannel, loadServers } = useStore()
  const { 
    connectToVoiceChannel, 
    currentVoiceChannelId, 
    participants, 
    disconnectFromVoiceChannel, 
    isMuted, 
    isDeafened,
    isConnected,
    toggleMute,
    toggleDeafen,
    speakingUsers
  } = useVoiceStore()
  const { user } = useAuthStore()
  const [isCreateTextModalOpen, setIsCreateTextModalOpen] = useState(false)
  const [isCreateVoiceModalOpen, setIsCreateVoiceModalOpen] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [voiceChannelMembers, setVoiceChannelMembers] = useState<Record<number, any[]>>({})
  
  // Состояние для контекстного меню
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    participant: any;
  } | null>(null);

  // Состояние для громкости участников (по умолчанию 100%)
  const [participantVolumes, setParticipantVolumes] = useState<Record<number, number>>({});

  // Состояние для пользователей, демонстрирующих экран
  const [screenSharingUsers, setScreenSharingUsers] = useState<Set<number>>(new Set());

  // Загружаем участников голосового канала
  const loadVoiceChannelMembers = async (voiceChannelId: number) => {
    try {
      const members = await channelService.getVoiceChannelMembers(voiceChannelId);
      setVoiceChannelMembers(prev => ({
        ...prev,
        [voiceChannelId]: members
      }));
    } catch (error) {
      console.error('Ошибка загрузки участников голосового канала:', error);
      // Если ошибка, устанавливаем пустой массив
      setVoiceChannelMembers(prev => ({
        ...prev,
        [voiceChannelId]: []
      }));
    }
  };

  // Загружаем участников всех голосовых каналов при смене сервера
  useEffect(() => {
    if (currentServer) {
      const voiceChannels = currentServer.channels.filter(c => c.type === 'voice');
      voiceChannels.forEach(channel => {
        loadVoiceChannelMembers(channel.id);
      });
    }
  }, [currentServer]);

  // Обработка уведомлений о голосовых каналах
  useEffect(() => {
    const handleVoiceChannelJoin = (event: any) => {
      const data = event.detail;
      console.log('Пользователь присоединился к голосовому каналу:', data);
      // Обновляем список участников для этого канала
      if (data.voice_channel_id) {
        loadVoiceChannelMembers(data.voice_channel_id);
      }
    };

    const handleVoiceChannelLeave = (event: any) => {
      const data = event.detail;
      console.log('Пользователь покинул голосовой канал:', data);
      // Обновляем список участников для этого канала
      if (data.voice_channel_id) {
        loadVoiceChannelMembers(data.voice_channel_id);
      }
    };

    // Обработчики глобальных событий
    const handleScreenShareStart = (event: any) => {
      const data = event.detail;
      setScreenSharingUsers(prev => {
        const prevArray = Array.from(prev);
        return new Set([...prevArray, data.user_id]);
      });
    };

    const handleScreenShareStop = (event: any) => {
      const data = event.detail;
      setScreenSharingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.user_id);
        return newSet;
      });
    };

    // Подписываемся на события
    window.addEventListener('voice_channel_join', handleVoiceChannelJoin);
    window.addEventListener('voice_channel_leave', handleVoiceChannelLeave);
    window.addEventListener('screen_share_start', handleScreenShareStart);
    window.addEventListener('screen_share_stop', handleScreenShareStop);

    return () => {
      window.removeEventListener('voice_channel_join', handleVoiceChannelJoin);
      window.removeEventListener('voice_channel_leave', handleVoiceChannelLeave);
      window.removeEventListener('screen_share_start', handleScreenShareStart);
      window.removeEventListener('screen_share_stop', handleScreenShareStop);
    };
  }, []);

  const handleChannelClick = async (channel: any) => {
    console.log('🔄 Клик по каналу:', channel.name, 'тип:', channel.type, 'ID:', channel.id);
    
    if (channel.type === 'voice') {
      // Обновляем список участников перед подключением
      await loadVoiceChannelMembers(channel.id);
      
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
    // Для других каналов показываем загруженных участников
    return voiceChannelMembers[channelId] || [];
  }

  // Обработка правого клика по участнику
  const handleParticipantContextMenu = (event: React.MouseEvent, participant: any) => {
    event.preventDefault();
    event.stopPropagation();
    
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      participant: participant,
    });
  };

  // Закрытие контекстного меню
  const handleContextMenuClose = () => {
    setContextMenu(null);
  };

  // Действия контекстного меню
  const handleMuteUser = () => {
    console.log('Заглушить пользователя:', contextMenu?.participant.username);
    // TODO: Реализовать заглушение пользователя
    handleContextMenuClose();
  };

  const handleKickUser = () => {
    console.log('Исключить пользователя:', contextMenu?.participant.username);
    // TODO: Реализовать исключение пользователя
    handleContextMenuClose();
  };

  const handleViewProfile = () => {
    console.log('Просмотреть профиль:', contextMenu?.participant.username);
    // TODO: Реализовать просмотр профиля
    handleContextMenuClose();
  };

  const handleSendMessage = () => {
    console.log('Отправить сообщение:', contextMenu?.participant.username);
    // TODO: Реализовать отправку личного сообщения
    handleContextMenuClose();
  };

  // Получение громкости участника (по умолчанию 100%)
  const getParticipantVolume = (userId: number): number => {
    // Сначала проверяем состояние
    if (participantVolumes[userId] !== undefined) {
      return participantVolumes[userId];
    }
    
    // Затем проверяем localStorage
    const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
    if (savedVolume) {
      const volume = parseInt(savedVolume);
      // Обновляем состояние
      setParticipantVolumes(prev => ({
        ...prev,
        [userId]: volume
      }));
      return volume;
    }
    
    return 100; // По умолчанию 100%
  };

  // Установка громкости участника
  const setParticipantVolume = (userId: number, volume: number) => {
    setParticipantVolumes(prev => ({
      ...prev,
      [userId]: volume
    }));

    // Сохраняем в localStorage
    localStorage.setItem(`voice-volume-${userId}`, volume.toString());

    // Применяем громкость к аудио элементу
    const audioElement = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement;
    if (audioElement) {
      audioElement.volume = Math.min(volume / 100, 3.0); // Ограничиваем до 300% (3.0)
      console.log(`🔊 Установлена громкость ${volume}% для пользователя ${userId}`);
    }
  };

  // Открытие демонстрации экрана
  const openScreenShare = (userId: number, username: string) => {
    // Создаем событие для открытия ScreenShareOverlay
    const event = new CustomEvent('open_screen_share', {
      detail: { userId, username }
    });
    window.dispatchEvent(event);
  };

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
                        {channelParticipants.map((participant) => {
                          const isScreenSharing = screenSharingUsers.has(participant.user_id);
                          return (
                            <div
                              key={participant.user_id}
                              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 transition-colors cursor-pointer"
                              onContextMenu={(e) => handleParticipantContextMenu(e, participant)}
                            >
                              <SpeakingAvatar username={participant.username} isSpeaking={speakingUsers.has(participant.user_id)} />
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
                              
                              {/* Индикатор демонстрации экрана */}
                              {isScreenSharing && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-6 h-6 p-0 text-green-400 hover:text-green-300 hover:bg-green-400/20"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openScreenShare(participant.user_id, participant.username);
                                  }}
                                  title={`${participant.username} демонстрирует экран - нажмите для просмотра`}
                                >
                                  <Monitor className="w-3 h-3" />
                                </Button>
                              )}
                              
                              <div className="flex gap-1">
                                {participant.is_muted && (
                                  <MicOff className="w-3 h-3 text-red-400" />
                                )}
                                {participant.is_deafened && (
                                  <Headphones className="w-3 h-3 text-red-400" />
                                )}
                              </div>
                            </div>
                          );
                        })}
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
      
      {/* Контекстное меню для участников голосового канала */}
      <Menu
        open={contextMenu !== null}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        PaperProps={{
          sx: {
            backgroundColor: 'rgb(47, 49, 54)',
            border: '1px solid rgb(60, 63, 69)',
            borderRadius: '8px',
            minWidth: '250px',
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.24)',
            '& .MuiMenuItem-root': {
              color: 'rgb(220, 221, 222)',
              fontSize: '14px',
              padding: '8px 12px',
              '&:hover': {
                backgroundColor: 'rgb(64, 68, 75)',
              },
              '&.Mui-disabled': {
                color: 'rgb(114, 118, 125)',
              },
            },
            '& .MuiDivider-root': {
              borderColor: 'rgb(60, 63, 69)',
              margin: '4px 0',
            },
          },
        }}
      >
        {contextMenu && (
          <>
            {/* Заголовок с информацией о пользователе */}
            <Paper
              sx={{
                backgroundColor: 'rgb(54, 57, 63)',
                margin: '8px',
                padding: '12px',
                borderRadius: '6px',
                border: 'none',
                boxShadow: 'none',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar 
                  sx={{ 
                    width: 32, 
                    height: 32, 
                    fontSize: '14px',
                    backgroundColor: 'rgb(88, 101, 242)',
                    fontWeight: 600,
                  }}
                >
                  {contextMenu.participant.username[0].toUpperCase()}
                </Avatar>
                <Box>
                  <Typography 
                    sx={{ 
                      fontWeight: 600, 
                      fontSize: '16px', 
                      color: 'rgb(220, 221, 222)',
                      lineHeight: 1.2,
                    }}
                  >
                    {contextMenu.participant.username}
                  </Typography>
                  <Typography 
                    sx={{ 
                      fontSize: '12px', 
                      color: 'rgb(163, 166, 170)',
                      lineHeight: 1,
                    }}
                  >
                    {contextMenu.participant.user_id === user?.id ? 'Это вы' : 'Участник'}
                  </Typography>
                </Box>
              </Box>
            </Paper>
            
            {/* Ползунок громкости для других пользователей */}
            {contextMenu.participant.user_id !== user?.id && (
              <Box sx={{ padding: '8px 16px 12px' }}>
                <Typography 
                  sx={{ 
                    fontSize: '12px', 
                    color: 'rgb(163, 166, 170)', 
                    marginBottom: '8px',
                    fontWeight: 500,
                  }}
                >
                  Громкость пользователя: {getParticipantVolume(contextMenu.participant.user_id)}%
                </Typography>
                <Slider
                  value={getParticipantVolume(contextMenu.participant.user_id)}
                  onChange={(_, value) => setParticipantVolume(contextMenu.participant.user_id, value as number)}
                  min={0}
                  max={300}
                  step={5}
                  sx={{
                    color: 'rgb(88, 101, 242)',
                    height: 6,
                    '& .MuiSlider-track': {
                      backgroundColor: 'rgb(88, 101, 242)',
                      border: 'none',
                    },
                    '& .MuiSlider-rail': {
                      backgroundColor: 'rgb(79, 84, 92)',
                    },
                    '& .MuiSlider-thumb': {
                      backgroundColor: 'rgb(255, 255, 255)',
                      border: '2px solid rgb(88, 101, 242)',
                      width: 16,
                      height: 16,
                      '&:hover': {
                        boxShadow: '0 0 0 8px rgba(88, 101, 242, 0.16)',
                      },
                    },
                  }}
                />
              </Box>
            )}
            
            <Divider />
            
            {/* Действия для других пользователей */}
            {contextMenu.participant.user_id !== user?.id && (
              <>
                <MenuItem onClick={handleSendMessage}>
                  <ListItemIcon sx={{ minWidth: '36px' }}>
                    <Hash size={18} color="rgb(163, 166, 170)" />
                  </ListItemIcon>
                  <ListItemText primary="Отправить сообщение" />
                </MenuItem>
                
                <MenuItem onClick={handleViewProfile}>
                  <ListItemIcon sx={{ minWidth: '36px' }}>
                    <UserCheck size={18} color="rgb(163, 166, 170)" />
                  </ListItemIcon>
                  <ListItemText primary="Посмотреть профиль" />
                </MenuItem>
                
                <Divider />
                
                {/* Модерационные действия (пока отключены) */}
                <MenuItem onClick={handleMuteUser} disabled>
                  <ListItemIcon sx={{ minWidth: '36px' }}>
                    <Volume1 size={18} color="rgb(114, 118, 125)" />
                  </ListItemIcon>
                  <ListItemText primary="Заглушить пользователя" />
                </MenuItem>
                
                <MenuItem onClick={handleKickUser} disabled>
                  <ListItemIcon sx={{ minWidth: '36px' }}>
                    <UserX size={18} color="rgb(237, 66, 69)" />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Исключить из канала" 
                    primaryTypographyProps={{ color: 'rgb(237, 66, 69)' }}
                  />
                </MenuItem>
              </>
            )}
            
            {/* Действия для себя */}
            {contextMenu.participant.user_id === user?.id && (
              <MenuItem onClick={handleViewProfile}>
                <ListItemIcon sx={{ minWidth: '36px' }}>
                  <UserCheck size={18} color="rgb(163, 166, 170)" />
                </ListItemIcon>
                <ListItemText primary="Мой профиль" />
              </MenuItem>
            )}
          </>
        )}
      </Menu>
    </>
  )
}