'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChannelSidebarView } from './ChannelSidebarView'
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
  buildPlacementsForMove,
  groupChannelsByCategory,
  type ChannelGroup,
} from '../lib/channelGrouping'

export function useChannelSidebarPresence({ model }: { model: any }) {
  const { currentServer, user, setVoiceChannelMembers, currentVoiceChannelId,
    setVoiceMemberProfile, setScreenSharingUsers, setActiveSharingUsers,
    setIsScreenSharing, setStreamHoverPreview } = model
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
    setVoiceMemberProfile((current: { member: ServerMember; roles: Role[]; anchorRect: DOMRect } | null) =>
      current?.member.user_id === updatedMember.user_id
        ? { ...current, member: updatedMember }
        : current
    )
    setVoiceChannelMembers((current: Record<number, any[]>) => {
      const next: Record<number, any[]> = {}
      for (const [channelId, members] of Object.entries(current) as [string, any[]][]) {
        next[Number(channelId)] = members.map((member: any) =>
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
      setVoiceChannelMembers((prev: Record<number, any[]>) => ({
        ...prev,
        [voiceChannelId]: nextMembers
      }));

      // Стрим мог начаться до открытия страницы — берём состояние из ответа API
      setScreenSharingUsers((prev: Set<number>) => {
        const next = new Set(prev);
        let changed = false;
        for (const member of nextMembers as any[]) {
          const memberId = member.id ?? member.user_id;
          if (memberId == null) continue;
          const sharing = Boolean(member.is_sharing_screen);
          if (sharing && !next.has(memberId)) {
            next.add(memberId);
            changed = true;
          } else if (!sharing && next.has(memberId)) {
            next.delete(memberId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch (error) {
      console.error('Ошибка загрузки участников голосового канала:', error);
      // Если ошибка, устанавливаем пустой массив
      setVoiceChannelMembers((prev: Record<number, any[]>) => ({
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
      const voiceChannels = currentServer.channels.filter((c: Channel) => c.type === 'voice');
      voiceChannels.forEach((channel: Channel) => {
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

    setVoiceChannelMembers((prev: Record<number, any[]>) => {
      const existing = prev[previousChannelId];
      if (!existing?.length) return prev;
      const filtered = existing.filter(
        (member: any) => (member.id ?? member.user_id) !== user.id
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

      setVoiceChannelMembers((prev: Record<number, any[]>) => {
        const next: Record<number, any[]> = {};
        for (const [channelId, members] of Object.entries(prev) as [string, any[]][]) {
          next[Number(channelId)] = members.map((member: any) => {
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

      setVoiceChannelMembers((prev: Record<number, any[]>) => {
        const channelId = data.voice_channel_id;
        const existing = prev[channelId] || [];
        if (existing.some((member: any) => (member.id ?? member.user_id) === data.user_id)) {
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

      setVoiceChannelMembers((prev: Record<number, any[]>) => {
        const channelId = data.voice_channel_id;
        const existing = prev[channelId] || [];
        return {
          ...prev,
          [channelId]: existing.filter((member: any) => (member.id ?? member.user_id) !== data.user_id),
        };
      });
    };

    // Обработчики глобальных событий
    const handleScreenShareStart = (event: any) => {
      const data = event.detail;
      setScreenSharingUsers((prev: Set<number>) => {
        const prevArray = Array.from(prev);
        return new Set([...prevArray, data.user_id]);
      });
    };

    const handleScreenShareStop = (event: any) => {
      const data = event.detail;
      setScreenSharingUsers((prev: Set<number>) => {
        const newSet = new Set(prev);
        newSet.delete(data.user_id);
        return newSet;
      });
      setStreamHoverPreview((prev: { userId: number; username: string; anchorRect: DOMRect } | null) =>
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
      setActiveSharingUsers((prev: { userId: number; username: string }[]) => {
        if (!prev.find((u: { userId: number }) => u.userId === user_id)) {
          return [...prev, { userId: user_id, username }];
        }
        return prev;
      });
    };

    const handleScreenShareStopForUserPanel = (event: any) => {
      const { user_id } = event.detail;
      updateScreenShareStatus();
      setActiveSharingUsers((prev: { userId: number; username: string }[]) => prev.filter((u: { userId: number }) => u.userId !== user_id));
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
  return {
    voiceMemberProfileRequestRef, openVoiceMemberProfile, handleVoiceProfileMemberUpdated,
    loadingChannelsRef, previousVoiceChannelIdRef, loadVoiceChannelMembers,
  }
}
