'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Hash, Volume2, ChevronDown, Settings, Plus, Mic, MicOff, Headphones, PhoneOff, VolumeX, Monitor, MonitorOff, UserX, UserCheck, Shield, Volume1, LogOut, Copy, UserPlus, Bell, Search } from 'lucide-react'
import { useStore } from '../lib/store'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { useAuthStore } from '../store/store'
import { useRouter } from 'next/navigation'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'
import { Slider } from './ui/slider'
import { UserAvatar } from './ui/user-avatar'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'
import voiceService from '../services/voiceService'
import optimizedVoiceService from '../services/optimizedVoiceService'
import { useScreenSharePickerStore } from '../store/screenSharePickerStore'
import { Channel, Role, ServerMember } from '../types'
import channelService from '../services/channelService'
import { Permissions } from '../lib/permissions'
import { useServerPermissions } from '../lib/serverPermissions'
import { ServerSettingsModal } from './ServerSettingsModal'
import { ChannelSettingsModal } from './ChannelSettingsModal'
import { CreateChannelModal } from './CreateChannelModal'
import { InvitePeopleModal } from './InvitePeopleModal'
import { ServerNotificationSettingsModal } from './ServerNotificationSettingsModal'

// Компонент для аватарки с анимацией при разговоре
import { SpeakingAvatar } from './SpeakingAvatar'
import { MemberProfilePopover } from './MemberProfilePopover'
import serverService from '../services/serverService'
import { openScreenShareView } from '../lib/screenShareNavigation'
import { StreamHoverPreview } from './StreamHoverPreview'
import {
  useMentionNotificationStore,
  formatMentionBadge,
} from '../store/mentionNotificationStore'
import { useChannelUnreadStore } from '../store/channelUnreadStore'

export function ChannelSidebar() {
  const { currentServer, currentChannel, selectChannel, addChannel, loadServers, updateServer } = useStore()
  const mentionPending = useMentionNotificationStore((state) => state.pending)
  const channelUnreadPending = useChannelUnreadStore((state) => state.pending)
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
  const { can: canManageServer } = useServerPermissions(currentServer?.id ?? null)
  const canManageChannels = canManageServer(Permissions.MANAGE_CHANNELS)
  const canCreateInvite = canManageServer(Permissions.CREATE_INVITE)
  // Публичный сервер — кнопка у всех; приватный — только с правом приглашать
  const canShowInviteButton = Boolean(currentServer?.is_public) || canCreateInvite
  const router = useRouter()
  const [isCreateChannelModalOpen, setIsCreateChannelModalOpen] = useState(false)
  const [createChannelInitialType, setCreateChannelInitialType] = useState<'text' | 'voice'>('text')
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
  const [streamHoverPreview, setStreamHoverPreview] = useState<{
    userId: number;
    username: string;
    anchorRect: DOMRect;
  } | null>(null);
  const streamHoverTimerRef = useRef<number | null>(null);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeSharingUsers, setActiveSharingUsers] = useState<{ userId: number; username: string }[]>([]);

  // Состояние для контекстного меню заголовка сервера
  const [serverContextMenu, setServerContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isChannelSettingsModalOpen, setIsChannelSettingsModalOpen] = useState(false)
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [channelSearch, setChannelSearch] = useState('')
  const [isNotificationSettingsOpen, setIsNotificationSettingsOpen] = useState(false)
  const [selectedChannelForSettings, setSelectedChannelForSettings] = useState<Channel | null>(null)
  const [hoveredChannel, setHoveredChannel] = useState<number | null>(null)
  const [voiceMemberProfile, setVoiceMemberProfile] = useState<{
    member: ServerMember;
    roles: Role[];
    anchorRect: DOMRect;
  } | null>(null)

  useEffect(() => {
    setChannelSearch('')
  }, [currentServer?.id])
  const voiceMemberProfileRequestRef = useRef(0)

  useEffect(() => {
    voiceMemberProfileRequestRef.current += 1
    setVoiceMemberProfile(null)
  }, [currentServer?.id])

  const openVoiceMemberProfile = async (participant: any, anchorRect: DOMRect) => {
    const serverId = currentServer?.id
    if (!serverId) return

    const requestId = ++voiceMemberProfileRequestRef.current

    try {
      const [membersResponse, roles] = await Promise.all([
        serverService.getMembers(serverId),
        serverService.getRoles(serverId),
      ])
      if (requestId !== voiceMemberProfileRequestRef.current) return

      const member = membersResponse.members.find(
        (candidate) => candidate.user_id === participant.user_id
      )
      if (!member) return

      setVoiceMemberProfile({ member, roles, anchorRect })
    } catch (error) {
      console.error('Failed to open voice member profile:', error)
    }
  }

  const handleVoiceProfileMemberUpdated = (updatedMember: ServerMember) => {
    setVoiceMemberProfile((current) =>
      current?.member.user_id === updatedMember.user_id
        ? { ...current, member: updatedMember }
        : current
    )
    setVoiceChannelMembers((current) => {
      const next: Record<number, any[]> = {}
      for (const [channelId, members] of Object.entries(current)) {
        next[Number(channelId)] = members.map((member) =>
          (member.id ?? member.user_id) === updatedMember.user_id
            ? {
                ...member,
                username: updatedMember.username,
                display_name: updatedMember.display_name,
                avatar_url: updatedMember.avatar_url,
              }
            : member
        )
      }
      return next
    })
  }

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
      setStreamHoverPreview((prev) =>
        prev?.userId === data.user_id ? null : prev
      );
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
  const handleScreenShareToggle = () => {
    try {
      if (isScreenSharing) {
        voiceService.stopScreenShare()
      } else {
        useScreenSharePickerStore.getState().open()
      }
      setIsScreenSharing(voiceService.getScreenSharingStatus())
      setError(null)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось запустить демонстрацию экрана')
    }
  };
  const handleViewScreenShare = () => {
    const streamer = activeSharingUsers[0];
    if (!streamer) return;
    openScreenShareView(streamer.userId, streamer.username);
  };

  const clearStreamHoverTimer = () => {
    if (streamHoverTimerRef.current !== null) {
      window.clearTimeout(streamHoverTimerRef.current);
      streamHoverTimerRef.current = null;
    }
  };

  const showStreamHoverPreview = (participant: { user_id: number; username: string }, anchorRect: DOMRect) => {
    clearStreamHoverTimer();
    setStreamHoverPreview({
      userId: participant.user_id,
      username: participant.username,
      anchorRect,
    });
  };

  const scheduleStreamHoverPreview = (
    participant: { user_id: number; username: string },
    anchorRect: DOMRect,
    delayMs = 350
  ) => {
    clearStreamHoverTimer();
    streamHoverTimerRef.current = window.setTimeout(() => {
      showStreamHoverPreview(participant, anchorRect);
    }, delayMs);
  };

  const hideStreamHoverPreview = (delayMs = 200) => {
    clearStreamHoverTimer();
    streamHoverTimerRef.current = window.setTimeout(() => {
      setStreamHoverPreview(null);
    }, delayMs);
  };

  const keepStreamHoverPreview = () => {
    clearStreamHoverTimer();
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
    const normalizedVolume = Math.min(100, Math.max(0, Math.round(volume)))

    setParticipantVolumes((currentVolumes) => ({
      ...currentVolumes,
      [userId]: normalizedVolume,
    }))
    optimizedVoiceService.setParticipantVolume(userId, normalizedVolume)
  }
  const openCreateChannelModal = (type: 'text' | 'voice') => {
    setCreateChannelInitialType(type)
    setIsCreateChannelModalOpen(true)
  }

  const handleChannelCreated = (newChannel: Channel) => {
    if (!currentServer) return
    addChannel(currentServer.id, newChannel)
    if (newChannel.type === 'text') {
      selectChannel(newChannel.id, 'text')
    }
    void loadServers()
  }

  const handleServerHeaderContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setServerContextMenu({ mouseX: event.clientX, mouseY: event.clientY });
  };

  const handleServerContextMenuClose = () => {
    setServerContextMenu(null);
  };

  const handleServerSettings = () => {
    setIsSettingsModalOpen(true);
    handleServerContextMenuClose();
  };

  const handleNotificationSettings = () => {
    setIsNotificationSettingsOpen(true)
    handleServerContextMenuClose()
  }

  const handleChannelSettings = (channel: Channel) => {
    if (currentServer && canManageChannels) {
      setSelectedChannelForSettings(channel);
      setIsChannelSettingsModalOpen(true);
    }
  };

  const handleChannelUpdate = (updatedChannel: Channel) => {
    setSelectedChannelForSettings(updatedChannel)
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

  if (!currentServer) {
    return (
      <div className="app-sidebar flex h-full flex-col border-r">
        <div className="h-12 px-4 flex items-center border-b border-border">
          <span className="font-semibold">Выберите сервер</span>
        </div>
      </div>
    )
  }

  const normalizedChannelSearch = channelSearch.trim().toLocaleLowerCase('ru')
  const textChannels = currentServer.channels.filter(
    (channel) => channel.type === 'text' && channel.name.toLocaleLowerCase('ru').includes(normalizedChannelSearch),
  )
  const voiceChannels = currentServer.channels.filter(
    (channel) => channel.type === 'voice' && channel.name.toLocaleLowerCase('ru').includes(normalizedChannelSearch),
  )

  return (
    <>
      <div className="app-sidebar flex h-full flex-col border-r">
        {/* Server Header */}
        <div className="channel-sidebar-header flex h-12 shrink-0 items-center gap-1 border-b border-border/70 px-3 shadow-sm">
          <button
            type="button"
            onClick={handleServerHeaderContextMenu}
            className="group flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left transition hover:bg-secondary/60"
          >
            <span className="truncate text-[15px] font-semibold text-foreground">
              {currentServer.name}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
          </button>

          {canShowInviteButton && (
            <Tooltip content="Пригласить на сервер" side="bottom">
              <button
                type="button"
                aria-label="Пригласить на сервер"
                onClick={() => setIsInviteModalOpen(true)}
                className="channel-header-invite flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary/80 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <UserPlus className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>

        <div className="mobile-channel-tools">
          <label className="mobile-channel-search">
            <Search aria-hidden="true" />
            <span className="sr-only">Поиск каналов</span>
            <input
              type="search"
              value={channelSearch}
              onChange={(event) => setChannelSearch(event.target.value)}
              placeholder="Поиск"
              aria-label="Поиск каналов"
            />
          </label>
          {canShowInviteButton && (
            <button
              type="button"
              onClick={() => setIsInviteModalOpen(true)}
              aria-label="Пригласить на сервер"
            >
              <UserPlus aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Channels List */}
        <div className="channel-sidebar-scroll flex-1 overflow-y-auto scrollbar-thin">
          {/* Text Channels */}
          <div className="pt-4">
            <div className="mb-1 px-3">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                <span>Текстовые каналы</span>
                <Tooltip content="Создать канал">
                  <button
                    type="button"
                    aria-label="Создать канал"
                    onClick={() => openCreateChannelModal('text')}
                    className="rounded p-0.5 text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="space-y-0.5 px-3">
              {textChannels.map((channel) => {
                const mentionCount = mentionPending.filter(
                  (item) => item.textChannelId === channel.id
                ).length
                const hasUnread =
                  mentionCount === 0 &&
                  channelUnreadPending.some((item) => item.textChannelId === channel.id)
                const showSettings =
                  hoveredChannel === channel.id &&
                  currentServer &&
                  canManageChannels

                return (
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
                      isSelectedChannel(channel) && "bg-accent text-foreground",
                      hasUnread && !isSelectedChannel(channel) && "text-foreground",
                      mentionCount > 0 && !isSelectedChannel(channel) && "text-[#f23f43]"
                    )}
                    onClick={() => handleChannelClick(channel)}
                  >
                    <Hash className={cn(
                      "w-4 h-4 flex-none",
                      isSelectedChannel(channel) ? "text-foreground" : "text-muted-foreground",
                      hasUnread && !isSelectedChannel(channel) && "text-foreground",
                      mentionCount > 0 && !isSelectedChannel(channel) && "text-[#f23f43]"
                    )} />
                    <span className={cn(
                      "min-w-0 flex-1 truncate text-left",
                      isSelectedChannel(channel) ? "text-foreground font-medium" : "",
                      hasUnread && !isSelectedChannel(channel) && "font-semibold text-foreground",
                      mentionCount > 0 && !isSelectedChannel(channel) && "font-semibold text-[#f23f43]"
                    )}>{channel.name}</span>
                    {mentionCount > 0 && !showSettings && (
                      <span className="ml-auto flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold leading-none text-white">
                        {formatMentionBadge(mentionCount)}
                      </span>
                    )}
                    {hasUnread && !showSettings && (
                      <span className="ml-auto h-2 w-2 flex-none rounded-full bg-foreground" />
                    )}
                  </Button>
                  {showSettings && (
                    <Tooltip
                      content="Настройки канала"
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-accent/50"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleChannelSettings(channel);
                        }}
                        aria-label="Настройки канала"
                      >
                        <Settings className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              )})}
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
                <Tooltip content="Создать канал">
                  <button
                    type="button"
                    aria-label="Создать канал"
                    onClick={() => openCreateChannelModal('voice')}
                    className="rounded p-0.5 text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="space-y-0.5 px-3">
              {voiceChannels.map((channel) => {
                const channelParticipants = getChannelParticipants(channel.id);
                const userLimit = channel.max_users ?? 0
                const hasUserLimit = userLimit > 0
                const isHovered = hoveredChannel === channel.id
                const showVoiceSettings = isHovered && canManageChannels
                const currentCount = channelParticipants.length

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
                          "interactive-row h-9 w-full justify-start gap-2 px-2.5 pr-10 text-muted-foreground",
                          currentVoiceChannelId === channel.id && "bg-green-500/10 text-green-500 ring-1 ring-inset ring-[#23a55a]/20"
                        )}
                        onClick={() => handleChannelClick(channel)}
                        disabled={isConnecting && currentVoiceChannelId !== channel.id}
                      >
                        <Volume2 className={cn(
                          "w-4 h-4 shrink-0",
                          currentVoiceChannelId === channel.id && "text-green-400"
                        )} />
                        <span className={cn(
                          "min-w-0 flex-1 truncate text-left",
                          currentVoiceChannelId === channel.id && "text-green-400"
                        )}>
                          {channel.name}
                        </span>
                        {currentVoiceChannelId === channel.id && !hasUserLimit && !showVoiceSettings && (
                          <div className="voice-status-dot shrink-0" />
                        )}
                      </Button>

                      {/* Лимит: двухцветная капсула с косым разрезом */}
                      {hasUserLimit && !showVoiceSettings && (
                        <span
                          aria-label={`Участников ${currentCount} из ${userLimit}`}
                          className="pointer-events-none absolute right-2 top-1/2 flex h-4 -translate-y-1/2 items-stretch overflow-hidden rounded-[8px] text-[12px] font-medium leading-none text-muted-foreground"
                        >
                          {/* Тёмная левая половина — косой срез справа */}
                          <span
                            className="relative z-[1] flex items-center bg-background pl-[6px] pr-[10px] tabular-nums tracking-tight"
                            style={{
                              clipPath: 'polygon(0 0, 100% 0, calc(100% - 5px) 100%, 0 100%)',
                            }}
                          >
                            {String(currentCount).padStart(2, '0')}
                          </span>
                          {/* Светлая правая половина */}
                          <span className="-ml-[5px] flex items-center bg-surface pl-[9px] pr-[6px] tabular-nums tracking-tight">
                            {String(userLimit).padStart(2, '0')}
                          </span>
                        </span>
                      )}

                      {showVoiceSettings && (
                        <Tooltip
                          content="Настройки канала"
                          className="absolute right-2 top-1/2 -translate-y-1/2"
                        >
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-[#35373c] hover:text-white"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleChannelSettings(channel);
                            }}
                            aria-label="Настройки канала"
                          >
                            <Settings className="h-4 w-4" />
                          </button>
                        </Tooltip>
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
                               className={cn(
                                 "interactive-row flex cursor-pointer items-center gap-2 overflow-visible px-2 py-1.5",
                                 voiceMemberProfile?.member.user_id === participant.user_id && "bg-gray-800"
                               )}
                               role="button"
                               tabIndex={0}
                               aria-haspopup="dialog"
                               aria-expanded={voiceMemberProfile?.member.user_id === participant.user_id}
                               onClick={(event) => {
                                 void openVoiceMemberProfile(
                                   participant,
                                   event.currentTarget.getBoundingClientRect()
                                 )
                               }}
                               onKeyDown={(event) => {
                                 if (event.key !== 'Enter' && event.key !== ' ') return
                                 event.preventDefault()
                                 void openVoiceMemberProfile(
                                   participant,
                                   event.currentTarget.getBoundingClientRect()
                                 )
                               }}
                               onContextMenu={(e) => handleParticipantContextMenu(e, participant)}
                              onMouseEnter={(e) => {
                                if (!isScreenSharing) return;
                                scheduleStreamHoverPreview(
                                  participant,
                                  e.currentTarget.getBoundingClientRect()
                                );
                              }}
                              onMouseLeave={() => {
                                if (!isScreenSharing) return;
                                hideStreamHoverPreview();
                              }}
                            >
                              <SpeakingAvatar
                                user={participant}
                                isSpeaking={Boolean(speakingUsers[participant.user_id])}
                                isScreenSharing={isScreenSharing}
                              />
                              <span
                                className={cn(
                                  "flex-1 text-xs",
                                  participant.is_deafened ? "text-red-400 line-through" : "text-muted-foreground"
                                )}
                              >
                                {participant.username}
                                {participant.user_id === user?.id && " (Вы)"}
                              </span>

                              {isScreenSharing && (
                                <span className="rounded bg-destructive px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                  В эфире
                                </span>
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

      {streamHoverPreview && (
        <StreamHoverPreview
          userId={streamHoverPreview.userId}
          username={streamHoverPreview.username}
          anchorRect={streamHoverPreview.anchorRect}
          isSelf={streamHoverPreview.userId === user?.id}
          onMouseEnter={keepStreamHoverPreview}
          onMouseLeave={() => hideStreamHoverPreview(120)}
        />
      )}

      <InvitePeopleModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        server={currentServer}
      />

      <CreateChannelModal
        isOpen={isCreateChannelModalOpen}
        onClose={() => setIsCreateChannelModalOpen(false)}
        serverId={currentServer.id}
        initialType={createChannelInitialType}
        categoryLabel={
          createChannelInitialType === 'voice' ? 'Голосовые каналы' : 'Текстовые каналы'
        }
        onCreated={handleChannelCreated}
      />

      {/* Контекстное меню для участников голосового канала */}
      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.mouseX ?? 0}
        y={contextMenu?.mouseY ?? 0}
        onClose={handleContextMenuClose}
      >
        {contextMenu && (
          <>
            <div className="m-2 rounded-panel bg-gray-800 p-3">
              <div className="flex items-center gap-3">
                <UserAvatar
                  user={{
                    username: contextMenu.participant.username,
                    display_name: contextMenu.participant.display_name,
                    avatar_url: contextMenu.participant.avatar_url,
                  }}
                  size={32}
                />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-foreground">
                    {contextMenu.participant.username}
                  </p>
                  <p className="text-xs text-text-quiet">
                    {contextMenu.participant.user_id === user?.id ? 'Это вы' : 'Участник'}
                  </p>
                </div>
              </div>
            </div>

            {contextMenu.participant.user_id !== user?.id && (
              <div className="px-4 pb-3 pt-1">
                <p className="mb-2 text-xs font-medium text-text-quiet">
                  Громкость пользователя: {getParticipantVolume(contextMenu.participant.user_id)}%
                </p>
                <Slider
                  value={[getParticipantVolume(contextMenu.participant.user_id)]}
                  onValueChange={(value) =>
                    setParticipantVolume(contextMenu.participant.user_id, value[0] ?? 100)
                  }
                  min={0}
                  max={100}
                  step={5}
                  aria-label={`Громкость пользователя ${contextMenu.participant.username}`}
                />
              </div>
            )}

            <ContextMenuSeparator />

            {contextMenu.participant.user_id !== user?.id && (
              <>
                <ContextMenuItem onClick={handleSendMessage}>
                  <Hash size={18} className="text-text-quiet" />
                  Отправить сообщение
                </ContextMenuItem>
                <ContextMenuItem onClick={handleViewProfile}>
                  <UserCheck size={18} className="text-text-quiet" />
                  Посмотреть профиль
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleMuteUser} disabled>
                  <Volume1 size={18} className="text-text-quiet" />
                  Заглушить пользователя
                </ContextMenuItem>
                <ContextMenuItem onClick={handleKickUser} disabled danger>
                  <UserX size={18} />
                  Исключить из канала
                </ContextMenuItem>
              </>
            )}

            {contextMenu.participant.user_id === user?.id && (
              <ContextMenuItem onClick={handleViewProfile}>
                <UserCheck size={18} className="text-text-quiet" />
                Мой профиль
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenu>

      {/* Контекстное меню для заголовка сервера */}
      <ContextMenu
        open={!!serverContextMenu}
        x={serverContextMenu?.mouseX ?? 0}
        y={serverContextMenu?.mouseY ?? 0}
        onClose={handleServerContextMenuClose}
      >
        <ContextMenuItem onClick={handleServerSettings}>
          <Settings size={18} className="text-text-quiet" />
          Настройки сервера
        </ContextMenuItem>
        <ContextMenuItem onClick={handleNotificationSettings}>
          <Bell size={18} className="text-text-quiet" />
          Настройки уведомлений
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleCopyServerId}>
          <Copy size={18} className="text-text-quiet" />
          Копировать ID
        </ContextMenuItem>
      </ContextMenu>

      <ServerNotificationSettingsModal
        isOpen={isNotificationSettingsOpen}
        onClose={() => setIsNotificationSettingsOpen(false)}
        server={currentServer}
      />

      {voiceMemberProfile && currentServer && (
        <MemberProfilePopover
          member={voiceMemberProfile.member}
          serverId={currentServer.id}
          roles={voiceMemberProfile.roles}
          anchorRect={voiceMemberProfile.anchorRect}
          onClose={() => setVoiceMemberProfile(null)}
          onMemberUpdated={handleVoiceProfileMemberUpdated}
        />
      )}

      <ServerSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        server={currentServer}
        onServerUpdate={(updatedServer) => {
          updateServer(updatedServer.id, updatedServer)
        }}
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
          onPermissionsChange={() => void loadServers()}
        />
      )}

    </>
  )
}
