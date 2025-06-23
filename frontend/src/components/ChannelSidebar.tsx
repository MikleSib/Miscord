'use client'

import { useState, useEffect } from 'react'
import { Hash, Volume2, ChevronDown, Settings, Plus, Mic, MicOff, Headphones, PhoneOff, VolumeX, Monitor, MonitorOff, UserX, UserCheck, Shield, Volume1, LogOut } from 'lucide-react'
import { useStore } from '../lib/store'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { useAuthStore } from '../store/store'
import { useRouter } from 'next/navigation'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import voiceService from '../services/voiceService'
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
  isScreenSharing?: boolean;
  size?: number;
}

function SpeakingAvatar({ username, isSpeaking, isScreenSharing, size = 20 }: SpeakingAvatarProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* Анимированная обводка для разговора */}
      {isSpeaking && !isScreenSharing && (
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

      {/* Рамка для демонстрации экрана */}
      {isScreenSharing && (
        <Box
          sx={{
            position: 'absolute',
            top: -3,
            left: -3,
            width: size + 6,
            height: size + 6,
            borderRadius: '50%',
            border: '2px solid #22c55e',
            background: 'linear-gradient(45deg, #22c55e, #16a34a)',
            animation: 'screen-share-pulse 2s ease-in-out infinite',
            '@keyframes screen-share-pulse': {
              '0%': {
                transform: 'scale(1)',
                opacity: 0.9,
              },
              '50%': {
                transform: 'scale(1.05)',
                opacity: 1,
              },
              '100%': {
                transform: 'scale(1)',
                opacity: 0.9,
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
          backgroundColor: isScreenSharing ? '#22c55e' : (isSpeaking ? '#00ff88' : '#5865f2'),
          color: 'white',
          fontWeight: 600,
          zIndex: 1,
          position: 'relative',
          border: isScreenSharing ? '2px solid #16a34a' : (isSpeaking ? '1px solid #00ff88' : '1px solid transparent'),
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
  const { user, logout } = useAuthStore()
  const router = useRouter()
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

  // Состояние для UserPanel функциональности
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeSharingUsers, setActiveSharingUsers] = useState<{ userId: number; username: string }[]>([]);

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

  // Обработчики для UserPanel функциональности
  useEffect(() => {
    // Подписываемся на изменения статуса демонстрации экрана
    const updateScreenShareStatus = () => {
      setIsScreenSharing(voiceService.getScreenSharingStatus());
    };

    // Обработчики событий демонстрации экрана для UserPanel
    const handleScreenShareStartForUserPanel = (event: any) => {
      const { user_id, username } = event.detail;
      setActiveSharingUsers(prev => {
        if (!prev.find(u => u.userId === user_id)) {
          return [...prev, { userId: user_id, username }];
        }
        return prev;
      });
    };

    const handleScreenShareStopForUserPanel = (event: any) => {
      const { user_id } = event.detail;
      setActiveSharingUsers(prev => prev.filter(u => u.userId !== user_id));
    };

    // Проверяем статус при загрузке
    updateScreenShareStatus();

    // Подписываемся на события
    window.addEventListener('screen_share_start', handleScreenShareStartForUserPanel);
    window.addEventListener('screen_share_stop', handleScreenShareStopForUserPanel);

    // Можно добавить слушатель событий если нужно
    const interval = setInterval(updateScreenShareStatus, 1000);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('screen_share_start', handleScreenShareStartForUserPanel);
      window.removeEventListener('screen_share_stop', handleScreenShareStopForUserPanel);
    };
  }, []);

  // Обработчики для UserPanel функциональности
  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleMuteToggle = () => {
    console.log('🎙️ Переключение микрофона, текущее состояние:', isMuted);
    toggleMute();
  };

  const handleDeafenToggle = () => {
    console.log('🎙️ Переключение наушников, текущее состояние:', isDeafened);
    toggleDeafen();
  };

  const handleDisconnect = () => {
    disconnectFromVoiceChannel();
  };

  const handleScreenShareToggle = async () => {
    if (isScreenSharing) {
      voiceService.stopScreenShare();
    } else {
      await voiceService.startScreenShare();
    }
    setIsScreenSharing(voiceService.getScreenSharingStatus());
  };

  const handleViewScreenShare = () => {
    // Создаем событие для открытия ScreenShareOverlay
    const event = new CustomEvent('open_screen_share', {
      detail: { 
        userId: activeSharingUsers[0]?.userId, 
        username: activeSharingUsers[0]?.username 
      }
    });
    window.dispatchEvent(event);
  };

  const handleChannelClick = async (channel: any) => {
    console.log('🔄 Клик по каналу:', channel.name, 'тип:', channel.type, 'ID:', channel.id);
    
    if (channel.type === 'voice') {
      // Проверяем, не подключены ли мы уже к этому каналу
      if (currentVoiceChannelId === channel.id) {
        console.log('🎙️ Уже подключены к этому голосовому каналу, игнорируем клик');
        // Просто выбираем канал в UI, но не переподключаемся
        console.log('🎙️ Вызываем selectChannel для голосового канала:', channel.id);
        selectChannel(channel.id);
        return;
      }

      // Если подключены к другому голосовому каналу, сначала отключаемся
      if (currentVoiceChannelId && currentVoiceChannelId !== channel.id) {
        console.log(`🎙️ Отключаемся от текущего канала ${currentVoiceChannelId} перед подключением к ${channel.id}`);
        try {
          await disconnectFromVoiceChannel();
          console.log('🎙️ Отключение от предыдущего канала завершено');
        } catch (error) {
          console.error('🎙️ Ошибка отключения от предыдущего канала:', error);
        }
      }

      // Обновляем список участников перед подключением
      await loadVoiceChannelMembers(channel.id);
      
      // Подключаемся к новому голосовому каналу
      try {
        console.log(`🎙️ Начинаем подключение к голосовому каналу ${channel.id}`);
        await connectToVoiceChannel(channel.id);
        console.log('🎙️ Вызываем selectChannel после подключения:', channel.id);
        selectChannel(channel.id);
        console.log('🎙️ Подключение завершено успешно');
      } catch (error) {
        console.error('🎙️ Ошибка подключения к голосовому каналу:', error);
      }
    } else {
      // Для текстовых каналов просто выбираем
      console.log('📝 Текстовый канал - вызываем selectChannel:', channel.id);
      console.log('📝 Функция selectChannel:', typeof selectChannel);
      console.log('📝 currentServer:', currentServer);
      console.log('📝 currentServer.channels:', currentServer?.channels);
      selectChannel(channel.id);
      console.log('📝 selectChannel вызван для текстового канала');
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
                    "w-full justify-start gap-1.5 h-8 px-2 text-muted-foreground hover:text-foreground hover:bg-accent/50",
                    currentChannel?.id === channel.id && "bg-accent text-foreground border-l-4 border-l-blue-500"
                  )}
                  onClick={() => handleChannelClick(channel)}
                >
                  <Hash className={cn(
                    "w-4 h-4",
                    currentChannel?.id === channel.id ? "text-foreground" : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    currentChannel?.id === channel.id ? "text-foreground font-medium" : ""
                  )}>{channel.name}</span>
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
                              <SpeakingAvatar username={participant.username} isSpeaking={speakingUsers.has(participant.user_id)} isScreenSharing={isScreenSharing} />
                              <Typography
                                variant="caption"
                                className={cn(
                                  "flex-1 text-xs",
                                  participant.is_deafened ? "text-red-400 line-through" : "text-muted-foreground"
                                )}
                              >
                                {participant.username}
                                {participant.user_id === user?.id && " (Вы)"}
                                {isScreenSharing && (
                                  <span className="text-green-400 font-medium ml-1">
                                    • Стримит
                                  </span>
                                )}
                              </Typography>
                              
                              {/* Индикатор демонстрации экрана */}
                              {isScreenSharing && (
                                <div className="flex items-center gap-1">
                                  {/* Анимированная точка */}
                                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                                  
                                  {/* Кнопка для просмотра */}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-7 h-7 p-0 text-green-400 hover:text-green-300 hover:bg-green-400/20 border border-green-400/30 hover:border-green-400/50 transition-all duration-200"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const event = new CustomEvent('open_screen_share', {
                                        detail: { userId: participant.user_id, username: participant.username }
                                      });
                                      window.dispatchEvent(event);
                                    }}
                                    title={`${participant.username} демонстрирует экран - нажмите для просмотра`}
                                  >
                                    <Monitor className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
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

        {/* Панель пользователя внизу */}
        <div className="mt-auto border-t border-border">
          {/* Информация о пользователе */}
          <div className="p-3 bg-secondary/50">
            <div className="flex items-center gap-3">
              <Avatar 
                sx={{ 
                  width: 32, 
                  height: 32, 
                  fontSize: '14px',
                  backgroundColor: 'rgb(88, 101, 242)',
                  fontWeight: 600,
                }}
              >
                {user?.username[0].toUpperCase()}
              </Avatar>
              <div className="flex-1 min-w-0">
                <Typography 
                  sx={{ 
                    fontWeight: 600, 
                    fontSize: '14px', 
                    color: 'rgb(220, 221, 222)',
                    lineHeight: 1.2,
                  }}
                >
                  {user?.username}
                </Typography>
                <Typography 
                  sx={{ 
                    fontSize: '12px', 
                    color: 'rgb(163, 166, 170)',
                    lineHeight: 1,
                  }}
                >
                  {currentVoiceChannelId ? 'В голосовом канале' : 'Онлайн'}
                </Typography>
              </div>
              
              {/* Кнопка настроек */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  console.log('ШЕСТЕРЕНКА В CHANNELSIDEBAR НАЖАТА!');
                  router.push('/settings');
                }}
                className="w-8 h-8 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/50"
                title="Настройки"
              >
                <Settings className="w-4 h-4" />
              </Button>
              
              {/* Кнопка выхода */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="w-8 h-8 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                title="Выйти"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Кнопки управления голосом (если подключен) */}
          {currentVoiceChannelId && (
            <div className="px-3 pb-3">
              <div className="flex items-center gap-1">
                {/* Кнопка микрофона */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMuteToggle}
                  className={cn(
                    "flex-1 h-8",
                    isMuted ? 'bg-red-600 hover:bg-red-700 text-white' : 'hover:bg-accent'
                  )}
                  title={isMuted ? 'Включить микрофон' : 'Отключить микрофон'}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </Button>

                {/* Кнопка наушников */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeafenToggle}
                  className={cn(
                    "flex-1 h-8",
                    isDeafened ? 'bg-red-600 hover:bg-red-700 text-white' : 'hover:bg-accent'
                  )}
                  title={isDeafened ? 'Включить звук' : 'Отключить звук'}
                >
                  {isDeafened ? <VolumeX className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
                </Button>

                {/* Кнопка демонстрации экрана */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleScreenShareToggle}
                  className={cn(
                    "flex-1 h-8",
                    isScreenSharing ? 'bg-green-600 hover:bg-green-700 text-white' : 'hover:bg-accent'
                  )}
                  title={isScreenSharing ? 'Остановить демонстрацию экрана' : 'Начать демонстрацию экрана'}
                >
                  {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                </Button>

                {/* Кнопка просмотра активных демонстраций */}
                {activeSharingUsers.length > 0 && !isScreenSharing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleViewScreenShare}
                    className="flex-1 h-8 bg-blue-600 hover:bg-blue-700 text-white relative"
                    title={`Смотреть демонстрацию экрана: ${activeSharingUsers.map(u => u.username).join(', ')}`}
                  >
                    <Monitor className="w-4 h-4" />
                    {activeSharingUsers.length > 1 && (
                      <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                        {activeSharingUsers.length}
                      </div>
                    )}
                  </Button>
                )}

                {/* Кнопка отключения */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  className="w-8 h-8 p-0 hover:bg-red-600 hover:text-white"
                  title="Отключиться от голосового канала"
                >
                  <PhoneOff className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
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