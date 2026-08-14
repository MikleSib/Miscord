'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChannelSidebarView } from './ChannelSidebarView'
import { useChannelSidebarPresence } from './useChannelSidebarPresence'
import { Hash, MessageSquare, Volume2, ChevronDown, Settings, Plus, FolderPlus, Mic, MicOff, Headphones, PhoneOff, VolumeX, Monitor, MonitorOff, UserX, UserCheck, Shield, Volume1, LogOut, Copy, UserPlus, Bell, Search } from 'lucide-react'
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
import { useChannelCategoryStore } from '../store/channelCategoryStore'
import { useChannelCategories } from './channels/useChannelCategories'
import { ChannelGroupList } from './channels/ChannelGroupList'
import { VoiceParticipantList } from './channels/VoiceParticipantList'
import {
  buildSidebarChannelGroups,
  buildPlacementsForMove,
  type ChannelGroup,
} from '../lib/channelGrouping'
import { subscribeToChannelSettingsRequests } from '../lib/channelSettingsEvents'

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
    updateParticipant,
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
    voiceChannelId: number;
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
  // id уникален только внутри типа: текстовый и голосовой канал могут иметь один id
  const [hoveredChannel, setHoveredChannel] = useState<string | null>(null)
  const [voiceMemberProfile, setVoiceMemberProfile] = useState<{
    member: ServerMember;
    roles: Role[];
    anchorRect: DOMRect;
  } | null>(null)
  const [draggingChannel, setDraggingChannel] = useState<Channel | null>(null)
  const [dropCategoryKey, setDropCategoryKey] = useState<string | null>(null)
  const {
    categories,
    categoriesReady,
    categoriesLoading,
    categoriesError,
    reloadCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    moveChannels,
  } = useChannelCategories(currentServer?.id ?? null)
  const collapsedCategories = useChannelCategoryStore((state) => state.collapsed)
  const toggleCategoryCollapsed = useChannelCategoryStore((state) => state.toggle)

  useEffect(() => {
    setChannelSearch('')
  }, [currentServer?.id])
  const {
    voiceMemberProfileRequestRef, openVoiceMemberProfile, handleVoiceProfileMemberUpdated,
    loadingChannelsRef, previousVoiceChannelIdRef, loadVoiceChannelMembers,
  } = useChannelSidebarPresence({ model: {
    currentServer, user, setVoiceChannelMembers, currentVoiceChannelId,
    setVoiceMemberProfile, setScreenSharingUsers, setActiveSharingUsers,
    setIsScreenSharing, setStreamHoverPreview,
  } })

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
      if (channel.kind === 'stage') {
        selectChannel(channel.id, 'voice');
        return;
      }
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
        server_muted: Boolean(member.server_muted),
        server_deafened: Boolean(member.server_deafened),
        is_bot: Boolean(member.is_bot),
        stage_role: member.stage_role,
        stage_suppressed: member.stage_suppressed,
        requested_to_speak_at: member.requested_to_speak_at,
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
        server_muted: Boolean(participant.server_muted),
        server_deafened: Boolean(participant.server_deafened),
        is_bot: Boolean(participant.is_bot),
        stage_role: participant.stage_role,
        stage_suppressed: participant.stage_suppressed,
        requested_to_speak_at: participant.requested_to_speak_at,
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
        server_muted: false,
        server_deafened: false,
        is_bot: false,
        stage_role: undefined,
        stage_suppressed: undefined,
        requested_to_speak_at: undefined,
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
  const handleParticipantContextMenu = (event: React.MouseEvent, participant: any, voiceChannelId: number) => {
    event.preventDefault();
    event.stopPropagation();

    const savedVolume = Number.parseInt(localStorage.getItem(`voice-volume-${participant.user_id}`) ?? '100', 10)
    const normalizedVolume = Number.isFinite(savedVolume) ? Math.min(100, Math.max(0, savedVolume)) : 100
    setParticipantVolumes((currentVolumes) => ({
      ...currentVolumes,
      [participant.user_id]: currentVolumes[participant.user_id] ?? normalizedVolume,
    }))
    setContextMenu({
      mouseX: event.clientX || event.currentTarget.getBoundingClientRect().right,
      mouseY: event.clientY || event.currentTarget.getBoundingClientRect().top,
      voiceChannelId,
      participant: participant,
    });
  };

  // Закрытие контекстного меню
  const handleContextMenuClose = () => {
    setContextMenu(null);
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

  const handleVoiceParticipantUpdated = (channelId: number, participant: any) => {
    setVoiceChannelMembers((current) => ({
      ...current,
      [channelId]: (current[channelId] || []).map((item) =>
        (item.id ?? item.user_id) === participant.user_id ? { ...item, ...participant } : item
      ),
    }))
    if (channelId === currentVoiceChannelId) {
      const current = participants.find((item) => item.user_id === participant.user_id)
      if (current) updateParticipant({ ...current, ...participant })
    }
    setContextMenu((current) => {
      if (!current || current.participant.user_id !== participant.user_id) return current
      return { ...current, participant: { ...current.participant, ...participant } }
    })
  }

  const handleVoiceParticipantRemoved = (channelId: number, userId: number) => {
    setVoiceChannelMembers((current) => ({
      ...current,
      [channelId]: (current[channelId] || []).filter((item) => (item.id ?? item.user_id) !== userId),
    }))
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

  useEffect(() => subscribeToChannelSettingsRequests(({ channelId, channelType }) => {
    if (!currentServer || !canManageChannels) return

    const channel = currentServer.channels.find(
      (item) => item.id === channelId && item.type === channelType,
    )
    if (channel) {
      setSelectedChannelForSettings(channel)
      setIsChannelSettingsModalOpen(true)
    }
  }), [currentServer, canManageChannels])

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

  const isSearching = normalizedChannelSearch.length > 0
  const { textGroups, voiceGroups } = buildSidebarChannelGroups(
    textChannels,
    voiceChannels,
    categories,
    isSearching,
  )
  const serverId = currentServer.id

  const handleDropOnCategory = (
    groups: ChannelGroup[],
    categoryId: number | null,
    index: number,
  ) => {
    const channel = draggingChannel
    setDraggingChannel(null)
    setDropCategoryKey(null)
    if (!channel) return
    void moveChannels(buildPlacementsForMove(groups, channel, categoryId, index))
  }

  const handleDeleteCategory = (categoryId: number, name: string) => {
    if (!window.confirm(`Удалить категорию «${name}»? Каналы останутся на сервере.`)) return
    void deleteCategory(categoryId)
  }

  const handleCreateCategory = (name: string) => createCategory(name)

  /** Общие пропсы для обоих списков каналов: текстового и голосового. */
  const groupListProps = {
    serverId,
    canManage: Boolean(canManageChannels),
    isSearching,
    collapsedCategories,
    draggingChannel,
    dropCategoryKey,
    onDragStart: setDraggingChannel,
    onDragEnd: () => {
      setDraggingChannel(null)
      setDropCategoryKey(null)
    },
    onDropTargetChange: setDropCategoryKey,
    onToggleCategory: (categoryId: number) => toggleCategoryCollapsed(serverId, categoryId),
    onRenameCategory: (categoryId: number, name: string) => void renameCategory(categoryId, name),
    onDeleteCategory: handleDeleteCategory,
  }

  return <ChannelSidebarView model={{
    currentServer, currentVoiceChannelId, isConnecting, user, speakingUsers, categories, categoriesReady, categoriesLoading, categoriesError, reloadCategories, updateServer, loadServers,
    isCreateChannelModalOpen, setIsCreateChannelModalOpen, createChannelInitialType, setCreateChannelInitialType, voiceChannelMembers, setVoiceChannelMembers,
    contextMenu, setContextMenu, participantVolumes, setParticipantVolumes, screenSharingUsers, setScreenSharingUsers,
    streamHoverPreview, setStreamHoverPreview, isScreenSharing, setIsScreenSharing, activeSharingUsers, setActiveSharingUsers,
    serverContextMenu, setServerContextMenu, isSettingsModalOpen, setIsSettingsModalOpen, isChannelSettingsModalOpen, setIsChannelSettingsModalOpen,
    isInviteModalOpen, setIsInviteModalOpen, channelSearch, setChannelSearch, isNotificationSettingsOpen, setIsNotificationSettingsOpen,
    selectedChannelForSettings, setSelectedChannelForSettings, hoveredChannel, setHoveredChannel, voiceMemberProfile, setVoiceMemberProfile,
    draggingChannel, setDraggingChannel, dropCategoryKey, setDropCategoryKey, mentionPending, channelUnreadPending,
    canManageChannels, canCreateInvite, canShowInviteButton, router, streamHoverTimerRef, collapsedCategories,
    toggleCategoryCollapsed, voiceMemberProfileRequestRef, openVoiceMemberProfile, handleVoiceProfileMemberUpdated, loadingChannelsRef, previousVoiceChannelIdRef,
    loadVoiceChannelMembers, handleLogout, handleMuteToggle, handleDeafenToggle, handleDisconnect, handleScreenShareToggle,
    handleViewScreenShare, clearStreamHoverTimer, showStreamHoverPreview, scheduleStreamHoverPreview, hideStreamHoverPreview, keepStreamHoverPreview,
    isSelectedChannel, handleChannelClick, getChannelParticipants, handleParticipantContextMenu, handleContextMenuClose,
    getParticipantVolume, setParticipantVolume, handleVoiceParticipantUpdated, handleVoiceParticipantRemoved, openCreateChannelModal,
    handleChannelCreated, handleServerHeaderContextMenu, handleServerContextMenuClose, handleServerSettings, handleNotificationSettings, handleChannelSettings,
    handleChannelUpdate, handleChannelDelete, handleCopyServerId, normalizedChannelSearch, textChannels, voiceChannels,
    isSearching, textGroups, voiceGroups, serverId, handleDropOnCategory,
    handleDeleteCategory, handleCreateCategory, groupListProps,
  }} />
}
