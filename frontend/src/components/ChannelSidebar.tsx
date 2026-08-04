'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Hash, Volume2, ChevronDown, Settings, Plus, Mic, MicOff, Headphones, PhoneOff, VolumeX, Monitor, MonitorOff, UserX, UserCheck, Shield, Volume1, LogOut, UserPlus, Copy, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { useAuthStore } from '../store/store'
import { useRouter } from 'next/navigation'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import voiceService from '../services/voiceService'
import { Channel } from '../types'
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
  IconButton,
} from '@mui/material'
import channelService from '../services/channelService'
import { applyMemberJoined } from '../lib/memberSync'
import { ServerSettingsModal } from './ServerSettingsModal'
import { ChannelSettingsModal } from './ChannelSettingsModal'

// Компонент для аватарки с анимацией при разговоре
import { SpeakingAvatar } from './SpeakingAvatar'
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
    speakingUsers,
    isConnecting,
    setError
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

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeSharingUsers, setActiveSharingUsers] = useState<{ userId: number; username: string }[]>([]);

  // Состояние для контекстного меню заголовка сервера
  const [serverContextMenu, setServerContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isChannelSettingsModalOpen, setIsChannelSettingsModalOpen] = useState(false)
  const [selectedChannelForSettings, setSelectedChannelForSettings] = useState<Channel | null>(null)
  const [hoveredChannel, setHoveredChannel] = useState<number | null>(null)

  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  // Ref для отслеживания загружаемых каналов (предотвращаем дублирующиеся запросы)
  const loadingChannelsRef = useRef<Set<number>>(new Set());
  // Канал, из которого только что вышли — чтобы сразу убрать себя из списка
  const previousVoiceChannelIdRef = useRef<number | null>(null);

  // Загружаем участников голосового канала
  // Используем useCallback чтобы функция была стабильной для обработчиков событий
  const loadVoiceChannelMembers = useCallback(async (voiceChannelId: number) => {
    // Предотвращаем дублирующиеся запросы
    if (loadingChannelsRef.current.has(voiceChannelId)) {
      return;
    }
    
    loadingChannelsRef.current.add(voiceChannelId);
    
    try {
      const members = await channelService.getVoiceChannelMembers(voiceChannelId);
      const currentUserId = useAuthStore.getState().user?.id;
      const liveChannelId = useVoiceStore.getState().currentVoiceChannelId;
      // Если мы уже вышли из канала, а API ещё отдаёт нас — не возвращаем себя в UI
      const nextMembers =
        currentUserId && liveChannelId !== voiceChannelId
          ? members.filter((member: any) => (member.id ?? member.user_id) !== currentUserId)
          : members;
      setVoiceChannelMembers(prev => ({
        ...prev,
        [voiceChannelId]: nextMembers
      }));
    } catch (error) {
      console.error('Ошибка загрузки участников голосового канала:', error);
      // Если ошибка, устанавливаем пустой массив
      setVoiceChannelMembers(prev => ({
        ...prev,
        [voiceChannelId]: []
      }));
    } finally {
      // Убираем из загружаемых после небольшой задержки
      setTimeout(() => {
        loadingChannelsRef.current.delete(voiceChannelId);
      }, 1000);
    }
  }, []);

  // Загружаем участников всех голосовых каналов при смене сервера
  useEffect(() => {
    if (currentServer) {
      const voiceChannels = currentServer.channels.filter(c => c.type === 'voice');
      voiceChannels.forEach(channel => {
        loadVoiceChannelMembers(channel.id);
      });
    }
  }, [currentServer, loadVoiceChannelMembers]);

  // При выходе из голоса сервер не шлёт нам самим leave — чистим локальный список сразу
  useEffect(() => {
    const previousChannelId = previousVoiceChannelIdRef.current;
    previousVoiceChannelIdRef.current = currentVoiceChannelId;

    if (!user?.id) return;
    if (previousChannelId == null) return;
    if (currentVoiceChannelId === previousChannelId) return;

    setVoiceChannelMembers((prev) => {
      const existing = prev[previousChannelId];
      if (!existing?.length) return prev;
      const filtered = existing.filter(
        (member) => (member.id ?? member.user_id) !== user.id
      );
      if (filtered.length === existing.length) return prev;
      return {
        ...prev,
        [previousChannelId]: filtered,
      };
    });

    // Подтянем актуальный список с сервера (без нас)
    void loadVoiceChannelMembers(previousChannelId);
  }, [currentVoiceChannelId, user?.id, loadVoiceChannelMembers]);

  // Мгновенно обновляем аватар/имя в списках голосовых каналов
  useEffect(() => {
    const handleUserProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const data = detail.data || detail;
      if (!data?.user_id) return;

      setVoiceChannelMembers((prev) => {
        const next: Record<number, any[]> = {};
        for (const [channelId, members] of Object.entries(prev)) {
          next[Number(channelId)] = members.map((member) => {
            const memberId = member.id ?? member.user_id;
            if (memberId !== data.user_id) return member;
            return {
              ...member,
              username: data.username ?? member.username,
              display_name:
                data.display_name !== undefined
                  ? data.display_name ?? undefined
                  : member.display_name,
              avatar_url:
                data.avatar_url !== undefined
                  ? data.avatar_url ?? undefined
                  : member.avatar_url,
            };
          });
        }
        return next;
      });
    };

    window.addEventListener('user_profile_updated', handleUserProfileUpdated);
    return () => window.removeEventListener('user_profile_updated', handleUserProfileUpdated);
  }, []);

  // Обработка уведомлений о голосовых каналах
  useEffect(() => {
    const handleVoiceChannelJoin = (event: any) => {
      const data = event.detail;
      if (!data?.voice_channel_id || !data?.user_id) return;

      setVoiceChannelMembers((prev) => {
        const channelId = data.voice_channel_id;
        const existing = prev[channelId] || [];
        if (existing.some((member) => (member.id ?? member.user_id) === data.user_id)) {
          return prev;
        }

        return {
          ...prev,
          [channelId]: [
            ...existing,
            {
              id: data.user_id,
              user_id: data.user_id,
              username: data.username,
              display_name: data.display_name,
              avatar_url: data.avatar_url,
              is_muted: false,
              is_deafened: false,
            },
          ],
        };
      });

      loadVoiceChannelMembers(data.voice_channel_id);
    };

    const handleVoiceChannelLeave = (event: any) => {
      const data = event.detail;
      if (!data?.voice_channel_id || !data?.user_id) return;

      setVoiceChannelMembers((prev) => {
        const channelId = data.voice_channel_id;
        const existing = prev[channelId] || [];
        return {
          ...prev,
          [channelId]: existing.filter((member) => (member.id ?? member.user_id) !== data.user_id),
        };
      });

      loadVoiceChannelMembers(data.voice_channel_id);
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
  }, [loadVoiceChannelMembers]);

  // Обработчики для UserPanel функциональности
  useEffect(() => {
    // Подписываемся на изменения статуса демонстрации экрана
    const updateScreenShareStatus = () => {
      setIsScreenSharing(voiceService.getScreenSharingStatus());
    };

    // Обработчики событий демонстрации экрана для UserPanel
    const handleScreenShareStartForUserPanel = (event: any) => {
      const { user_id, username } = event.detail;
      updateScreenShareStatus();
      setActiveSharingUsers(prev => {
        if (!prev.find(u => u.userId === user_id)) {
          return [...prev, { userId: user_id, username }];
        }
        return prev;
      });
    };

    const handleScreenShareStopForUserPanel = (event: any) => {
      const { user_id } = event.detail;
      updateScreenShareStatus();
      setActiveSharingUsers(prev => prev.filter(u => u.userId !== user_id));
    };

    // Проверяем статус при загрузке
    updateScreenShareStatus();

    // Подписываемся на события
    window.addEventListener('screen_share_start', handleScreenShareStartForUserPanel);
    window.addEventListener('screen_share_stop', handleScreenShareStopForUserPanel);

    // Можно добавить слушатель событий если нужно
    return () => {
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
    toggleMute();
  };

  const handleDeafenToggle = () => {
    toggleDeafen();
  };

  const handleDisconnect = async () => {
    try {
      await disconnectFromVoiceChannel()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось отключиться от голосового канала')
    }
  };
  const handleScreenShareToggle = async () => {
    try {
      if (isScreenSharing) {
        voiceService.stopScreenShare()
      } else {
        await voiceService.startScreenShare()
      }
      setIsScreenSharing(voiceService.getScreenSharingStatus())
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось запустить демонстрацию экрана')
    }
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

  const isSelectedChannel = (channel: { id: number; type: string }) =>
    currentChannel?.id === channel.id && currentChannel?.type === channel.type

  const handleChannelClick = async (channel: any) => {
    if (channel.type === 'voice') {
      if (isConnecting) return
      // Уже в этом голосовом — текстовый канал не трогаем
      if (currentVoiceChannelId === channel.id) {
        return;
      }

      // Если подключены к другому голосовому каналу, сначала отключаемся
      if (currentVoiceChannelId && currentVoiceChannelId !== channel.id) {
        try {
          await disconnectFromVoiceChannel();
        } catch (error) {
        }
      }

      // Обновляем список участников перед подключением
      await loadVoiceChannelMembers(channel.id);
      
      // Подключаемся к голосу, но НЕ меняем выбранный текстовый канал
      try {
        await connectToVoiceChannel(channel.id);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Не удалось подключиться к голосовому каналу')
      }
    } else {
      // Для текстовых каналов просто выбираем
      selectChannel(channel.id, 'text');
    }
  }

  // Участники голосового канала: API (уже в канале) + live WebRTC-список
  const getChannelParticipants = (channelId: number) => {
    const fromApi = voiceChannelMembers[channelId] || [];
    const normalize = (member: any) => {
      const userId = member.user_id ?? member.id;
      return {
        user_id: userId,
        username: member.username || member.display_name || 'User',
        display_name: member.display_name,
        avatar_url: member.avatar_url,
        is_muted: Boolean(member.is_muted),
        is_deafened: Boolean(member.is_deafened),
      };
    };

    if (currentVoiceChannelId !== channelId) {
      // Не в этом канале — себя не показываем (иначе после выхода «зависаем» в списке)
      return fromApi
        .map(normalize)
        .filter((member) => !user || member.user_id !== user.id);
    }

    // Пока идёт подключение, participants ещё пустой — друзья уже в канале
    // должны оставаться видимыми из API, иначе кажется что вы один.
    const byId = new Map<number, ReturnType<typeof normalize>>();

    for (const member of fromApi) {
      const normalized = normalize(member);
      if (normalized.user_id != null) {
        byId.set(normalized.user_id, normalized);
      }
    }

    for (const participant of participants) {
      byId.set(participant.user_id, {
        user_id: participant.user_id,
        username: participant.username || participant.display_name || 'User',
        display_name: participant.display_name,
        avatar_url: participant.avatar_url,
        is_muted: Boolean(participant.is_muted),
        is_deafened: Boolean(participant.is_deafened),
      });
    }

    if (user && !byId.has(user.id)) {
      byId.set(user.id, {
        user_id: user.id,
        username: user.display_name || user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        is_muted: false,
        is_deafened: false,
      });
    } else if (user && byId.has(user.id)) {
      // Свои mute/deafen — из актуального voice store
      const self = byId.get(user.id)!;
      const liveSelf = participants.find((p) => p.user_id === user.id);
      byId.set(user.id, {
        ...self,
        username: user.display_name || user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        is_muted: liveSelf?.is_muted ?? self.is_muted,
        is_deafened: liveSelf?.is_deafened ?? self.is_deafened,
      });
    }

    const merged = Array.from(byId.values());
    // Себя всегда сверху списка
    if (!user) return merged;
    return [
      ...merged.filter((p) => p.user_id === user.id),
      ...merged.filter((p) => p.user_id !== user.id),
    ];
  }

  // Обработка правого клика по участнику
  const handleParticipantContextMenu = (event: React.MouseEvent, participant: any) => {
    event.preventDefault();
    event.stopPropagation();
    
    const savedVolume = Number.parseInt(localStorage.getItem(`voice-volume-${participant.user_id}`) ?? '100', 10)
    const normalizedVolume = Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) : 100
    setParticipantVolumes((currentVolumes) => ({
      ...currentVolumes,
      [participant.user_id]: currentVolumes[participant.user_id] ?? normalizedVolume,
    }))
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

    // TODO: Реализовать заглушение пользователя
    handleContextMenuClose();
  };

  const handleKickUser = () => {
    // TODO: Реализовать исключение пользователя
    handleContextMenuClose();
  };

  const handleViewProfile = () => {
    // TODO: Реализовать просмотр профиля
    handleContextMenuClose();
  };

  const handleSendMessage = () => {
    console.log('Отправить сообщение:', contextMenu?.participant.username);
    // TODO: Реализовать отправку личного сообщения
    handleContextMenuClose();
  };

  // Получение громкости участника (по умолчанию 100%)
  const getParticipantVolume = (userId: number): number => participantVolumes[userId] ?? 100

  const setParticipantVolume = (userId: number, volume: number) => {
    const normalizedVolume = Math.min(100, Math.max(0, volume))

    setParticipantVolumes((currentVolumes) => ({
      ...currentVolumes,
      [userId]: normalizedVolume,
    }))
    localStorage.setItem(`voice-volume-${userId}`, normalizedVolume.toString())

    const audioElement = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement | null
    if (audioElement) {
      audioElement.volume = normalizedVolume / 100
    }
  }
  const handleCreateTextChannel = async () => {
    if (!newChannelName.trim() || !currentServer) return

    setIsCreating(true)
    try {
      const newTextChannel = await channelService.createTextChannel(currentServer.id, {
        name: newChannelName.trim(),
        position: currentServer.channels.filter((c) => c.type === 'text').length,
      })

      const newChannel: Channel = {
        id: newTextChannel.id,
        name: newTextChannel.name,
        type: 'text',
        serverId: currentServer.id,
        position: newTextChannel.position,
      }

      addChannel(currentServer.id, newChannel)
      selectChannel(newChannel.id, 'text')
      setIsCreateTextModalOpen(false)
      setNewChannelName('')
    } catch (error) {
      console.error('Ошибка создания текстового канала:', error)
      setError('Не удалось создать текстовый канал')
    } finally {
      setIsCreating(false)
    }
  }

  const handleCreateVoiceChannel = async () => {
    if (!newChannelName.trim() || !currentServer) return

    setIsCreating(true)
    try {
      const newVoiceChannel = await channelService.createVoiceChannel(currentServer.id, {
        name: newChannelName.trim(),
        position: currentServer.channels.filter((c) => c.type === 'voice').length,
        max_users: 10,
      })

      const newChannel: Channel = {
        id: newVoiceChannel.id,
        name: newVoiceChannel.name,
        type: 'voice',
        serverId: currentServer.id,
        position: newVoiceChannel.position,
        max_users: newVoiceChannel.max_users,
      }

      addChannel(currentServer.id, newChannel)
      setIsCreateVoiceModalOpen(false)
      setNewChannelName('')
    } catch (error) {
      console.error('Ошибка создания голосового канала:', error)
      setError('Не удалось создать голосовой канал')
    } finally {
      setIsCreating(false)
    }
  }

  const handleServerHeaderContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setServerContextMenu({ mouseX: event.clientX, mouseY: event.clientY });
  };

  const handleServerContextMenuClose = () => {
    setServerContextMenu(null);
  };

  const handleInviteToServer = () => {
    setIsInviteModalOpen(true);
    handleServerContextMenuClose();
  };

  const handleServerSettings = () => {
    setIsSettingsModalOpen(true);
    handleServerContextMenuClose();
  };

  const handleChannelSettings = (channel: Channel) => {
    // Проверяем, является ли текущий пользователь владельцем сервера
    if (currentServer && currentServer.owner_id === user?.id) {
      setSelectedChannelForSettings(channel);
      setIsChannelSettingsModalOpen(true);
    }
  };

  const handleChannelUpdate = () => {
    void loadServers()
  }

  const handleChannelDelete = (channelId: number, channelType?: 'text' | 'voice') => {
    if (
      currentServer &&
      currentChannel?.id === channelId &&
      (!channelType || currentChannel.type === channelType)
    ) {
      const nextChannel = currentServer.channels.find(
        (channel) => !(channel.id === channelId && channel.type === (channelType || currentChannel.type))
      )
      if (nextChannel) {
        selectChannel(nextChannel.id, nextChannel.type)
      }
    }
    void loadServers()
  }
  const handleCopyServerId = () => {
    if (currentServer) {
      navigator.clipboard.writeText(currentServer.id.toString());
    }
    handleServerContextMenuClose();
  };

  const handleInviteUser = async () => {
    if (!inviteUsername.trim() || !currentServer) return;
    setIsInviting(true);
    setInviteError('');
    try {
      const result = await channelService.inviteUserToServer(currentServer.id, inviteUsername);
      applyMemberJoined({
        channel_id: currentServer.id,
        user_id: result.user_id,
        username: result.username,
        display_name: result.display_name,
        avatar_url: result.avatar_url,
        user: result.user,
      });
      setIsInviteModalOpen(false);
      setInviteUsername('');
    } catch (error: any) {
      console.error('Ошибка приглашения пользователя:', error);
      if (error.response?.data?.detail) {
        setInviteError(error.response.data.detail);
      } else {
        setInviteError('Не удалось пригласить пользователя');
      }
    } finally {
      setIsInviting(false);
    }
  };

  if (!currentServer) {
    return (
      <div className="app-sidebar flex h-full flex-col border-r">
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
      <div className="app-sidebar flex h-full flex-col border-r">
        {/* Server Header */}
        <div
          className="interactive-row mx-3 mb-2 mt-3 flex h-10 cursor-pointer items-center justify-between border border-border/60 px-3 text-sm hover:text-foreground"
          onClick={handleServerHeaderContextMenu}
        >
          <span className="font-semibold">{currentServer.name}</span>
          <ChevronDown className="w-4 h-4" />
        </div>

        {/* Channels List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* Text Channels */}
          <div className="pt-4">
            <div className="mb-1 px-3">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Текстовые каналы</span>
                <Plus 
                  className="w-4 h-4 cursor-pointer hover:text-foreground" 
                  onClick={() => setIsCreateTextModalOpen(true)}
                />
              </div>
            </div>
            <div className="space-y-0.5 px-3">
              {textChannels.map((channel) => (
                <div
                  key={channel.id}
                  className="relative group"
                  onMouseEnter={() => setHoveredChannel(channel.id)}
                  onMouseLeave={() => setHoveredChannel(null)}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "interactive-row h-9 w-full justify-start gap-2 px-2.5 text-muted-foreground hover:text-foreground",
                      isSelectedChannel(channel) && "bg-accent text-foreground"
                    )}
                    onClick={() => handleChannelClick(channel)}
                  >
                    <Hash className={cn(
                      "w-4 h-4",
                      isSelectedChannel(channel) ? "text-foreground" : "text-muted-foreground"
                    )} />
                    <span className={cn(
                      isSelectedChannel(channel) ? "text-foreground font-medium" : ""
                    )}>{channel.name}</span>
                  </Button>
                  {hoveredChannel === channel.id && currentServer && currentServer.owner_id === user?.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 w-6 h-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-accent/50"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleChannelSettings(channel);
                      }}
                      title="Настройки канала"
                    >
                      <Settings className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </Button>
                  )}
                </div>
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
            <div className="mb-1 px-3">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Голосовые каналы</span>
                <Plus 
                  className="w-4 h-4 cursor-pointer hover:text-foreground" 
                  onClick={() => setIsCreateVoiceModalOpen(true)}
                />
              </div>
            </div>
            <div className="space-y-0.5 px-3">
              {voiceChannels.map((channel) => {
                const channelParticipants = getChannelParticipants(channel.id);
                return (
                  <div key={channel.id}>
                    <div
                      className="relative group"
                      onMouseEnter={() => setHoveredChannel(channel.id)}
                      onMouseLeave={() => setHoveredChannel(null)}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "interactive-row h-9 w-full justify-start gap-2 px-2.5 text-muted-foreground",
                          currentVoiceChannelId === channel.id && "bg-[#23a55a]/10 text-[#23a55a] ring-1 ring-inset ring-[#23a55a]/20"
                        )}
                        onClick={() => handleChannelClick(channel)}
                        disabled={isConnecting && currentVoiceChannelId !== channel.id}
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
                          <div className="voice-status-dot ml-auto" />
                        )}
                      </Button>
                      {hoveredChannel === channel.id && currentServer && currentServer.owner_id === user?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 w-6 h-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-accent/50"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleChannelSettings(channel);
                          }}
                          title="Настройки канала"
                        >
                          <Settings className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                        </Button>
                      )}
                    </div>
                    
                    {/* Участники голосового канала */}
                    {channelParticipants.length > 0 && (
                      <div className="ml-6 mt-1 space-y-1">
                        {channelParticipants.map((participant) => {
                          const isScreenSharing = screenSharingUsers.has(participant.user_id);
                          return (
                            <div
                              key={participant.user_id}
                              className="interactive-row flex cursor-pointer items-center gap-2 overflow-visible px-2 py-1.5"
                              onContextMenu={(e) => handleParticipantContextMenu(e, participant)}
                            >
                              <SpeakingAvatar
                                user={participant}
                                isSpeaking={Boolean(speakingUsers[participant.user_id])}
                                isScreenSharing={isScreenSharing}
                              />
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
                                  <div className="voice-status-dot" />
                                  
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
                                  <MicOff key="muted" className="w-3 h-3 text-red-400" />
                                )}
                                {participant.is_deafened && (
                                  <Headphones key="deafened" className="w-3 h-3 text-red-400" />
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
      </div>

      {/* Модальное окно создания текстового канала */}
      <Dialog
        open={isCreateTextModalOpen}
        onClose={() => {
          if (!isCreating) {
            setIsCreateTextModalOpen(false)
            setNewChannelName('')
          }
        }}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#323339',
            color: 'white',
            borderRadius: '12px',
            border: '1px solid #3e3f45',
          },
        }}
      >
        <DialogContent sx={{ padding: '24px' }}>
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">Создать текстовый канал</h2>
              <p className="mt-1 text-sm text-[#999aa1]">Введите название для нового канала</p>
            </div>
            <IconButton
              onClick={() => {
                setIsCreateTextModalOpen(false)
                setNewChannelName('')
              }}
              disabled={isCreating}
              sx={{ color: '#999aa1' }}
            >
              <X size={20} />
            </IconButton>
          </div>
          <TextField
            label="Название канала"
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newChannelName.trim() && !isCreating) {
                void handleCreateTextChannel()
              }
            }}
            fullWidth
            required
            autoFocus
            name="miscord-text-channel-name"
            autoComplete="off"
            inputProps={{
              autoComplete: 'off',
              autoCorrect: 'off',
              autoCapitalize: 'off',
              spellCheck: false,
              'data-lpignore': 'true',
              'data-1p-ignore': 'true',
              'data-form-type': 'other',
            }}
            InputLabelProps={{ sx: { color: '#999aa1' } }}
            InputProps={{
              sx: {
                color: 'white',
                backgroundColor: '#1e1f22',
                borderRadius: '8px',
                '& fieldset': { borderColor: '#3e3f45' },
                '&:hover fieldset': { borderColor: '#5865f2' },
                '&.Mui-focused fieldset': { borderColor: '#5865f2' },
              },
            }}
          />
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateTextModalOpen(false)
                setNewChannelName('')
              }}
              disabled={isCreating}
              className="border-[#4e5058] bg-transparent text-white hover:bg-[#4e5058]"
            >
              Отмена
            </Button>
            <Button
              onClick={() => void handleCreateTextChannel()}
              disabled={!newChannelName.trim() || isCreating}
              className="bg-[#5865f2] text-white hover:bg-[#4752c4]"
            >
              {isCreating ? 'Создание...' : 'Создать'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Voice Channel Modal */}
      <Dialog
        open={isCreateVoiceModalOpen}
        onClose={() => {
          if (!isCreating) {
            setIsCreateVoiceModalOpen(false)
            setNewChannelName('')
          }
        }}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#323339',
            color: 'white',
            borderRadius: '12px',
            border: '1px solid #3e3f45',
          },
        }}
      >
        <DialogContent sx={{ padding: '24px' }}>
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">Создать голосовой канал</h2>
              <p className="mt-1 text-sm text-[#999aa1]">Введите название для нового канала</p>
            </div>
            <IconButton
              onClick={() => {
                setIsCreateVoiceModalOpen(false)
                setNewChannelName('')
              }}
              disabled={isCreating}
              sx={{ color: '#999aa1' }}
            >
              <X size={20} />
            </IconButton>
          </div>
          <TextField
            label="Название канала"
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newChannelName.trim() && !isCreating) {
                void handleCreateVoiceChannel()
              }
            }}
            fullWidth
            required
            autoFocus
            name="miscord-voice-channel-name"
            autoComplete="off"
            inputProps={{
              autoComplete: 'off',
              autoCorrect: 'off',
              autoCapitalize: 'off',
              spellCheck: false,
              'data-lpignore': 'true',
              'data-1p-ignore': 'true',
              'data-form-type': 'other',
            }}
            InputLabelProps={{ sx: { color: '#999aa1' } }}
            InputProps={{
              sx: {
                color: 'white',
                backgroundColor: '#1e1f22',
                borderRadius: '8px',
                '& fieldset': { borderColor: '#3e3f45' },
                '&:hover fieldset': { borderColor: '#5865f2' },
                '&.Mui-focused fieldset': { borderColor: '#5865f2' },
              },
            }}
          />
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateVoiceModalOpen(false)
                setNewChannelName('')
              }}
              disabled={isCreating}
              className="border-[#4e5058] bg-transparent text-white hover:bg-[#4e5058]"
            >
              Отмена
            </Button>
            <Button
              onClick={() => void handleCreateVoiceChannel()}
              disabled={!newChannelName.trim() || isCreating}
              className="bg-[#5865f2] text-white hover:bg-[#4752c4]"
            >
              {isCreating ? 'Создание...' : 'Создать'}
            </Button>
          </div>
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
            backgroundColor: 'rgb(44, 45, 50)',
            border: '1px solid rgb(62, 63, 69)',
            borderRadius: '8px',
            minWidth: '250px',
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.24)',
            '& .MuiMenuItem-root': {
              color: 'rgb(245, 245, 245)',
              fontSize: '14px',
              padding: '8px 12px',
              '&:hover': {
                backgroundColor: 'rgb(62, 63, 69)',
              },
              '&.Mui-disabled': {
                color: 'rgb(125, 126, 135)',
              },
            },
            '& .MuiDivider-root': {
              borderColor: 'rgb(62, 63, 69)',
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
                backgroundColor: 'rgb(57, 58, 65)',
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
                      color: 'rgb(245, 245, 245)',
                      lineHeight: 1.2,
                    }}
                  >
                    {contextMenu.participant.username}
                  </Typography>
                  <Typography 
                    sx={{ 
                      fontSize: '12px', 
                      color: 'rgb(153, 154, 161)',
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
                    color: 'rgb(153, 154, 161)',
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
                  max={100}
                  step={5}
                  sx={{
                    color: 'rgb(88, 101, 242)',
                    height: 6,
                    '& .MuiSlider-track': {
                      backgroundColor: 'rgb(88, 101, 242)',
                      border: 'none',
                    },
                    '& .MuiSlider-rail': {
                      backgroundColor: 'rgb(68, 69, 74)',
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
                    <Hash size={18} color="rgb(153, 154, 161)" />
                  </ListItemIcon>
                  <ListItemText primary="Отправить сообщение" />
                </MenuItem>
                
                <MenuItem onClick={handleViewProfile}>
                  <ListItemIcon sx={{ minWidth: '36px' }}>
                    <UserCheck size={18} color="rgb(153, 154, 161)" />
                  </ListItemIcon>
                  <ListItemText primary="Посмотреть профиль" />
                </MenuItem>
                
                <Divider />
                
                {/* Модерационные действия (пока отключены) */}
                <MenuItem onClick={handleMuteUser} disabled>
                  <ListItemIcon sx={{ minWidth: '36px' }}>
                    <Volume1 size={18} color="rgb(125, 126, 135)" />
                  </ListItemIcon>
                  <ListItemText primary="Заглушить пользователя" />
                </MenuItem>
                
                <MenuItem onClick={handleKickUser} disabled>
                  <ListItemIcon sx={{ minWidth: '36px' }}>
                    <UserX size={18} color="rgb(218, 62, 68)" />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Исключить из канала" 
                    primaryTypographyProps={{ color: 'rgb(218, 62, 68)' }}
                  />
                </MenuItem>
              </>
            )}
            
            {/* Действия для себя */}
            {contextMenu.participant.user_id === user?.id && (
              <MenuItem onClick={handleViewProfile}>
                <ListItemIcon sx={{ minWidth: '36px' }}>
                  <UserCheck size={18} color="rgb(153, 154, 161)" />
                </ListItemIcon>
                <ListItemText primary="Мой профиль" />
              </MenuItem>
            )}
          </>
        )}
      </Menu>

      {/* Контекстное меню для заголовка сервера */}
      <Menu
        open={!!serverContextMenu}
        onClose={handleServerContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          serverContextMenu !== null
            ? { top: serverContextMenu.mouseY, left: serverContextMenu.mouseX }
            : undefined
        }
        PaperProps={{
          sx: {
            backgroundColor: 'rgb(44, 45, 50)',
            border: '1px solid rgb(62, 63, 69)',
            borderRadius: '8px',
            minWidth: '200px',
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.24)',
            '& .MuiMenuItem-root': {
              color: 'rgb(245, 245, 245)',
              fontSize: '14px',
              padding: '8px 12px',
              '&:hover': {
                backgroundColor: 'rgb(62, 63, 69)',
              },
              '&.Mui-disabled': {
                color: 'rgb(125, 126, 135)',
              },
            },
            '& .MuiDivider-root': {
              borderColor: 'rgb(62, 63, 69)',
              margin: '4px 0',
            },
          },
        }}
      >
        <MenuItem onClick={handleInviteToServer}>
          <ListItemIcon sx={{ minWidth: '36px' }}>
            <UserPlus size={18} color="rgb(153, 154, 161)" />
          </ListItemIcon>
          <ListItemText primary="Пригласить людей" />
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleServerSettings}>
          <ListItemIcon sx={{ minWidth: '36px' }}>
            <Settings size={18} color="rgb(153, 154, 161)" />
          </ListItemIcon>
          <ListItemText primary="Настройки сервера" />
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleCopyServerId}>
          <ListItemIcon sx={{ minWidth: '36px' }}>
            <Copy size={18} color="rgb(153, 154, 161)" />
          </ListItemIcon>
          <ListItemText primary="Копировать ID" />
        </MenuItem>
      </Menu>

      <ServerSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        server={currentServer}
        onServerUpdate={() => { void loadServers() }}
      />

      {selectedChannelForSettings && (
        <ChannelSettingsModal
          isOpen={isChannelSettingsModalOpen}
          onClose={() => {
            setIsChannelSettingsModalOpen(false)
            setSelectedChannelForSettings(null)
          }}
          channel={selectedChannelForSettings}
          onChannelUpdate={handleChannelUpdate}
          onChannelDelete={handleChannelDelete}
        />
      )}

      {/* Invite User Modal */}
      <Dialog 
        open={isInviteModalOpen} 
        onClose={() => {
          setIsInviteModalOpen(false)
          setInviteError('')
          setInviteUsername('')
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            backgroundColor: '#323339',
            color: 'white',
            borderRadius: '8px',
            minWidth: '440px'
          }
        }}
      >
        <DialogContent sx={{ padding: 0 }}>
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">Пригласить пользователя</h2>
                <p className="text-[#999aa1] text-sm">
                  {currentServer ? `на сервер ${currentServer.name}` : 'на сервер'}
                </p>
              </div>
              <IconButton
                onClick={() => {
                  setIsInviteModalOpen(false)
                  setInviteError('')
                  setInviteUsername('')
                }}
                sx={{ color: '#999aa1' }}
              >
                <X size={24} />
              </IconButton>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#999aa1] mb-2">
                  Имя пользователя *
                </label>
                <TextField
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                  fullWidth
                  placeholder="Введите имя пользователя..."
                  error={!!inviteError}
                  helperText={inviteError}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: '#1e1f22',
                      color: 'white',
                      fontSize: '16px',
                      '& fieldset': {
                        borderColor: '#393a41',
                      },
                      '&:hover fieldset': {
                        borderColor: '#5865f2',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#5865f2',
                      },
                      '&.Mui-error fieldset': {
                        borderColor: '#da3e44',
                      },
                    },
                    '& .MuiInputBase-input': {
                      padding: '12px 16px',
                    },
                    '& .MuiFormHelperText-root': {
                      color: '#da3e44',
                      marginLeft: 0,
                      marginTop: '8px',
                    },
                  }}
                />
              </div>

              {!inviteError && (
                <div className="bg-[#2c2d32] p-4 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-[#5865f2] rounded-full flex items-center justify-center text-white font-semibold">
                      ?
                    </div>
                    <div>
                      <h4 className="text-white font-medium text-sm mb-1">Как пригласить пользователя</h4>
                      <p className="text-[#999aa1] text-xs leading-relaxed">
                        Введите точное имя пользователя. После приглашения пользователь получит уведомление 
                        и сможет присоединиться к серверу.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end mt-6 pt-6 border-t border-[#393a3f]">
              <Button
                variant="outline"
                onClick={() => {
                  setIsInviteModalOpen(false)
                  setInviteError('')
                  setInviteUsername('')
                }}
                disabled={isInviting}
                className="bg-transparent border-[#4e5058] text-white hover:bg-[#4e5058] hover:border-[#4e5058] px-6"
              >
                Отмена
              </Button>
              <Button
                onClick={handleInviteUser}
                disabled={!inviteUsername.trim() || isInviting}
                className="bg-[#5865f2] hover:bg-[#4752c4] text-white px-6"
              >
                {isInviting ? 'Приглашение...' : 'Пригласить'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}