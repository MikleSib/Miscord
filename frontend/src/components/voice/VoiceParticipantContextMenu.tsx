'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AtSign, Check, ChevronLeft, ChevronRight, Copy, Headphones, Loader2,
  MessageSquare, MicOff, Shield, UserCheck, UserPlus, UserX, Volume2, VolumeX,
} from 'lucide-react'

import { useStore } from '../../lib/store'
import { queueDirectMessage } from '../../lib/dmNavigation'
import { hasPermission, Permissions } from '../../lib/permissions'
import { useServerPermissions } from '../../lib/serverPermissions'
import channelService from '../../services/channelService'
import friendService from '../../services/friendService'
import serverService from '../../services/serverService'
import { useChatComposerIntentStore } from '../../store/chatComposerIntentStore'
import type { Channel, Role, Server, ServerMember, User } from '../../types'
import type { VoiceParticipant } from '../channels/VoiceParticipantList'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '../ui/context-menu'
import { Slider } from '../ui/slider'
import { UserAvatar } from '../ui/user-avatar'

export interface VoiceParticipantMenuTarget {
  mouseX: number
  mouseY: number
  voiceChannelId: number
  participant: VoiceParticipant
}

interface VoiceParticipantContextMenuProps {
  target: VoiceParticipantMenuTarget | null
  server: Server
  currentUserId?: number
  volume: number
  onVolumeChange: (userId: number, volume: number) => void
  onClose: () => void
  onOpenProfile: (participant: VoiceParticipant, anchorRect: DOMRect) => void
  onParticipantUpdated: (voiceChannelId: number, participant: VoiceParticipant) => void
  onParticipantRemoved: (voiceChannelId: number, userId: number) => void
  onMemberUpdated: (member: ServerMember) => void
}

type View = 'main' | 'roles' | 'move'

function apiError(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

function participantUser(participant: VoiceParticipant): User {
  return {
    id: participant.user_id,
    username: participant.username,
    email: '',
    display_name: participant.display_name,
    avatar_url: participant.avatar_url || undefined,
    is_bot: participant.is_bot,
  }
}

function MenuCheck({ checked }: { checked: boolean }) {
  return (
    <span className="ml-auto flex h-4 w-4 items-center justify-center rounded border border-border bg-canvas-deep">
      {checked && <Check className="h-3 w-3 text-primary" />}
    </span>
  )
}

export function VoiceParticipantContextMenu({
  target,
  server,
  currentUserId,
  volume,
  onVolumeChange,
  onClose,
  onOpenProfile,
  onParticipantUpdated,
  onParticipantRemoved,
  onMemberUpdated,
}: VoiceParticipantContextMenuProps) {
  const [view, setView] = useState<View>('main')
  const [member, setMember] = useState<ServerMember | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [voicePermissions, setVoicePermissions] = useState(0)
  const [loadingMember, setLoadingMember] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const selectServer = useStore((state) => state.selectServer)
  const selectChannel = useStore((state) => state.selectChannel)
  const currentChannel = useStore((state) => state.currentChannel)
  const queueMention = useChatComposerIntentStore((state) => state.queueMention)
  const { isLoaded, isOwner, topRolePosition, can } = useServerPermissions(server.id)

  const participant = target?.participant
  const isSelf = participant?.user_id === currentUserId
  const manageable = Boolean(
    member && !isSelf && !member.is_owner && (isOwner || member.top_role_position < topRolePosition),
  )
  const canMute = manageable && hasPermission(voicePermissions, Permissions.MUTE_MEMBERS)
  const canDeafen = manageable && hasPermission(voicePermissions, Permissions.DEAFEN_MEMBERS)
  const canMove = manageable && hasPermission(voicePermissions, Permissions.MOVE_MEMBERS)
  const canKick = manageable && can(Permissions.KICK_MEMBERS)
  const canManageRoles = manageable && can(Permissions.MANAGE_ROLES)

  const voiceChannels = useMemo(
    () => server.channels.filter((channel) => channel.type === 'voice'),
    [server.channels],
  )
  const manageableRoles = useMemo(
    () => roles.filter((role) => !role.is_default && (isOwner || role.position < topRolePosition)),
    [roles, isOwner, topRolePosition],
  )

  useEffect(() => {
    setView('main')
    setFeedback(null)
    setBusy(null)
    setMember(null)
    setRoles([])
    setVoicePermissions(0)
    if (!target) return
    let current = true
    setLoadingMember(true)
    void Promise.all([
      serverService.getMembers(server.id),
      serverService.getRoles(server.id),
      channelService.getMyVoiceChannelPermissions(target.voiceChannelId),
    ])
      .then(([response, nextRoles, permissions]) => {
        if (!current) return
        setMember(response.members.find((item) => item.user_id === target.participant.user_id) ?? null)
        setRoles(nextRoles)
        setVoicePermissions(permissions)
      })
      .catch(() => current && setFeedback('Не удалось загрузить данные участника. Повторите попытку.'))
      .finally(() => current && setLoadingMember(false))
    return () => { current = false }
  }, [target?.participant.user_id, target?.voiceChannelId, server.id])

  if (!target || !participant) return null

  const run = async (key: string, action: () => Promise<void>, close = false) => {
    if (busy) return
    setBusy(key)
    setFeedback(null)
    try {
      await action()
      if (close) onClose()
    } catch (error) {
      setFeedback(apiError(error, 'Не удалось выполнить действие. Повторите попытку.'))
    } finally {
      setBusy(null)
    }
  }

  const openProfile = () => {
    onClose()
    onOpenProfile(
      participant,
      new DOMRect(target.mouseX, target.mouseY, 1, 1),
    )
  }

  const openDirectMessage = async () => {
    queueDirectMessage(participantUser(participant))
    await selectServer(0)
    onClose()
  }

  const insertMention = async () => {
    const destination = currentChannel?.type === 'text'
      ? currentChannel
      : server.channels.find((channel) => channel.type === 'text' && channel.kind !== 'forum')
    if (!destination) {
      setFeedback('На сервере нет текстового канала для упоминания.')
      return
    }
    queueMention(destination.id, participant.user_id)
    await selectChannel(destination.id, 'text')
    onClose()
  }

  const toggleLocalMute = () => {
    const key = `voice-volume-last-${participant.user_id}`
    if (volume > 0) {
      localStorage.setItem(key, String(volume))
      onVolumeChange(participant.user_id, 0)
    } else {
      const saved = Number.parseInt(localStorage.getItem(key) || '100', 10)
      onVolumeChange(participant.user_id, Number.isFinite(saved) && saved > 0 ? saved : 100)
    }
  }

  const moderate = (data: { server_muted?: boolean; server_deafened?: boolean }) => run(
    data.server_muted !== undefined ? 'mute' : 'deafen',
    async () => {
      const updated = await channelService.moderateVoiceMember(
        target.voiceChannelId,
        participant.user_id,
        data,
      )
      onParticipantUpdated(target.voiceChannelId, { ...participant, ...updated })
    },
  )

  const toggleRole = (role: Role) => run(`role-${role.id}`, async () => {
    if (!member) return
    const hasRole = member.role_ids.includes(role.id)
    if (hasRole) await serverService.removeMemberRole(server.id, member.user_id, role.id)
    else await serverService.addMemberRole(server.id, member.user_id, role.id)
    const roleIds = hasRole
      ? member.role_ids.filter((id) => id !== role.id)
      : [...member.role_ids, role.id]
    const nextRoles = roles.filter((item) => roleIds.includes(item.id))
    const updated = {
      ...member,
      role_ids: roleIds,
      roles: nextRoles,
      top_role_position: Math.max(...nextRoles.map((item) => item.position), 0),
      color: nextRoles.find((item) => item.color)?.color || null,
    }
    setMember(updated)
    onMemberUpdated(updated)
  })

  const moveTo = (channel: Channel) => run(`move-${channel.id}`, async () => {
    await channelService.moveVoiceMember(target.voiceChannelId, participant.user_id, channel.id)
    onParticipantRemoved(target.voiceChannelId, participant.user_id)
  }, true)

  const disconnect = () => run('disconnect', async () => {
    await channelService.disconnectVoiceMember(target.voiceChannelId, participant.user_id)
    onParticipantRemoved(target.voiceChannelId, participant.user_id)
  }, true)

  const kick = () => {
    if (!window.confirm(`Исключить ${participant.display_name || participant.username} с сервера?`)) return
    void run('kick', async () => {
      await serverService.kickMember(server.id, participant.user_id)
      onParticipantRemoved(target.voiceChannelId, participant.user_id)
    }, true)
  }

  const copyId = () => run('copy', async () => {
    await navigator.clipboard.writeText(String(participant.user_id))
    setFeedback('ID пользователя скопирован.')
  })

  const addFriend = () => run('friend', async () => {
    await friendService.sendFriendRequest(participant.username)
    setFeedback('Запрос в друзья отправлен.')
  })

  const header = (
    <div className="mx-2 mb-1 rounded-panel bg-canvas-deep p-2.5">
      <div className="flex items-center gap-2.5">
        <UserAvatar user={participantUser(participant)} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {participant.display_name || participant.username}
          </p>
          <p className="truncate text-xs text-text-quiet">
            {isSelf ? 'Это вы' : participant.is_bot ? 'Бот' : `@${participant.username}`}
          </p>
        </div>
        {loadingMember && <Loader2 className="h-4 w-4 animate-spin text-text-quiet" />}
      </div>
    </div>
  )

  return (
    <ContextMenu
      open
      x={target.mouseX}
      y={target.mouseY}
      onClose={onClose}
      className="w-[292px]"
    >
      {header}
      {view !== 'main' && (
        <ContextMenuItem onClick={() => setView('main')}>
          <ChevronLeft className="h-4 w-4 text-text-quiet" />
          Назад
        </ContextMenuItem>
      )}

      {view === 'roles' && (
        <>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-quiet">Роли</p>
          {manageableRoles.map((role) => (
            <ContextMenuItem
              key={role.id}
              disabled={busy !== null}
              onClick={() => void toggleRole(role)}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: role.color || '#949ba4' }} />
              <span className="min-w-0 flex-1 truncate">{role.name}</span>
              <MenuCheck checked={Boolean(member?.role_ids.includes(role.id))} />
            </ContextMenuItem>
          ))}
          {!manageableRoles.length && <p className="px-3 py-2 text-xs text-text-quiet">Нет доступных ролей.</p>}
        </>
      )}

      {view === 'move' && (
        <>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-quiet">Переместить в</p>
          {voiceChannels.filter((channel) => channel.id !== target.voiceChannelId).map((channel) => (
            <ContextMenuItem key={channel.id} disabled={busy !== null} onClick={() => void moveTo(channel)}>
              <Volume2 className="h-4 w-4 text-text-quiet" />
              <span className="truncate">{channel.name}</span>
            </ContextMenuItem>
          ))}
          {voiceChannels.length <= 1 && <p className="px-3 py-2 text-xs text-text-quiet">Других голосовых каналов нет.</p>}
        </>
      )}

      {view === 'main' && (
        <>
          <ContextMenuItem onClick={openProfile}>
            <UserCheck className="h-4 w-4 text-text-quiet" />
            {isSelf ? 'Мой профиль' : 'Профиль'}
          </ContextMenuItem>
          {!isSelf && !participant.is_bot && (
            <>
              <ContextMenuItem onClick={() => void insertMention()}>
                <AtSign className="h-4 w-4 text-text-quiet" />
                Упомянуть
              </ContextMenuItem>
              <ContextMenuItem onClick={() => void openDirectMessage()}>
                <MessageSquare className="h-4 w-4 text-text-quiet" />
                Написать сообщение
              </ContextMenuItem>
              <ContextMenuItem disabled={busy !== null} onClick={() => void addFriend()}>
                <UserPlus className="h-4 w-4 text-text-quiet" />
                Добавить в друзья
              </ContextMenuItem>
            </>
          )}

          {!isSelf && (
            <>
              <ContextMenuSeparator />
              <div className="px-3 pb-3 pt-2">
                <div className="mb-2 flex items-center justify-between text-xs text-text-quiet">
                  <span>Громкость пользователя</span>
                  <span className="tabular-nums">{volume}%</span>
                </div>
                <Slider
                  value={[volume]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(value) => onVolumeChange(participant.user_id, value[0] ?? 100)}
                  aria-label={`Громкость пользователя ${participant.username}`}
                />
              </div>
              <ContextMenuItem onClick={toggleLocalMute}>
                {volume === 0 ? <Volume2 className="h-4 w-4 text-text-quiet" /> : <VolumeX className="h-4 w-4 text-text-quiet" />}
                {volume === 0 ? 'Включить звук пользователя' : 'Заглушить для себя'}
                <MenuCheck checked={volume === 0} />
              </ContextMenuItem>
            </>
          )}

          {!isSelf && isLoaded && (canManageRoles || canMove || canMute || canDeafen || canKick) && (
            <>
              <ContextMenuSeparator />
              {canManageRoles && (
                <ContextMenuItem onClick={() => setView('roles')}>
                  <Shield className="h-4 w-4 text-text-quiet" />
                  Роли
                  <ChevronRight className="ml-auto h-4 w-4 text-text-quiet" />
                </ContextMenuItem>
              )}
              {canMove && (
                <ContextMenuItem onClick={() => setView('move')}>
                  <Volume2 className="h-4 w-4 text-text-quiet" />
                  Переместить в
                  <ChevronRight className="ml-auto h-4 w-4 text-text-quiet" />
                </ContextMenuItem>
              )}
              {canMute && (
                <ContextMenuItem disabled={busy !== null} onClick={() => void moderate({ server_muted: !participant.server_muted })}>
                  <MicOff className="h-4 w-4 text-text-quiet" />
                  Откл. микрофон на сервере
                  <MenuCheck checked={Boolean(participant.server_muted)} />
                </ContextMenuItem>
              )}
              {canDeafen && (
                <ContextMenuItem disabled={busy !== null} onClick={() => void moderate({ server_deafened: !participant.server_deafened })}>
                  <Headphones className="h-4 w-4 text-text-quiet" />
                  Откл. звук на сервере
                  <MenuCheck checked={Boolean(participant.server_deafened)} />
                </ContextMenuItem>
              )}
              {canMove && (
                <ContextMenuItem danger disabled={busy !== null} onClick={() => void disconnect()}>
                  <VolumeX className="h-4 w-4" />
                  Отключить от канала
                </ContextMenuItem>
              )}
              {canKick && (
                <ContextMenuItem danger disabled={busy !== null} onClick={kick}>
                  <UserX className="h-4 w-4" />
                  Исключить с сервера
                </ContextMenuItem>
              )}
            </>
          )}

          <ContextMenuSeparator />
          <ContextMenuItem disabled={busy !== null} onClick={() => void copyId()}>
            <Copy className="h-4 w-4 text-text-quiet" />
            Копировать ID пользователя
          </ContextMenuItem>
        </>
      )}

      {feedback && (
        <p className="mx-2 my-1 rounded-md bg-canvas-deep px-2.5 py-2 text-xs text-text-body" role="status">
          {feedback}
        </p>
      )}
    </ContextMenu>
  )
}
