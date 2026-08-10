'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Loader2, MessageSquare, MoreHorizontal, Pencil, Plus, Smile, UserPlus, X } from 'lucide-react';

import { UserAvatar } from './ui/user-avatar';
import { Tooltip } from './ui/tooltip';
import serverService from '../services/serverService';
import friendService from '../services/friendService';
import { useAuthStore } from '../store/store';
import { useStore } from '../lib/store';
import { queueDirectMessage } from '../lib/dmNavigation';
import { cn } from '../lib/utils';
import { resolveMediaUrl } from '../lib/mediaUrl';
import { getMemberDisplayName } from '../lib/memberListGrouping';
import { Permissions } from '../lib/permissions';
import { useServerPermissions } from '../lib/serverPermissions';
import { openUserSettings } from '../lib/userSettingsNavigation';
import { Role, ServerMember, User } from '../types';

const POPOVER_WIDTH = 340;

const EMOJI_CODE_POINTS = [
  [0x1f600], [0x1f603], [0x1f604], [0x1f601], [0x1f606], [0x1f602],
  [0x1f642], [0x1f609], [0x1f60d], [0x1f970], [0x1f60e], [0x1f914],
  [0x1f44d], [0x1f44f], [0x2764, 0xfe0f], [0x1f525], [0x1f389], [0x1f4af],
] as const;

type Feedback = { tone: 'success' | 'error'; text: string } | null;

function getApiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : fallback;
}

type AnchorRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  height: number;
};

interface MemberProfilePopoverProps {
  member: ServerMember;
  serverId: number;
  roles: Role[];
  anchorRect: AnchorRect;
  onClose: () => void;
  onMemberUpdated?: (member: ServerMember) => void;
}

function pickBannerColor(member: ServerMember): string {
  if (member.color) return member.color;
  const coloredRole = member.roles?.find((role) => role.color);
  return coloredRole?.color || '#8b6914';
}

export function MemberProfilePopover({
  member,
  serverId,
  roles,
  anchorRect,
  onClose,
  onMemberUpdated,
}: MemberProfilePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const currentUser = useAuthStore((state) => state.user);
  const selectServer = useStore((state) => state.selectServer);
  const { isOwner, topRolePosition, can } = useServerPermissions(serverId);

  const displayName = getMemberDisplayName(member);
  const bannerColor = pickBannerColor(member);
  const isSelf = currentUser?.id === member.user_id;
  const canManageRoles = can(Permissions.MANAGE_ROLES);
  const canManageMemberRoles =
    canManageRoles &&
    !isSelf &&
    !member.is_owner &&
    (isOwner || member.top_role_position < topRolePosition);

  const messageInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [busyRoleId, setBusyRoleId] = useState<number | null>(null);
  const [friendStatus, setFriendStatus] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const assignableRoles = useMemo(
    () => canManageMemberRoles
      ? roles.filter((role) =>
          !role.is_default &&
          !member.role_ids.includes(role.id) &&
          (isOwner || role.position < topRolePosition)
        )
      : [],
    [roles, member.role_ids, canManageMemberRoles, isOwner, topRolePosition]
  );

  const position = useMemo(() => {
    const maxHeight = 560;
    const top = Math.max(12, Math.min(anchorRect.top - 24, window.innerHeight - maxHeight - 12));
    // Слева от якоря (как у списка участников); если места мало — справа
    const leftCandidate = anchorRect.left - POPOVER_WIDTH - 12;
    const rightCandidate = anchorRect.right + 12;
    const left =
      leftCandidate >= 12
        ? leftCandidate
        : Math.min(rightCandidate, window.innerWidth - POPOVER_WIDTH - 12);
    return { top, left: Math.max(12, left) };
  }, [anchorRect]);

  useEffect(() => {
    setMessage('');
    setFriendStatus('idle');
    setShowMoreMenu(false);
    setShowEmojiPicker(false);
    setShowRolePicker(false);
    setFeedback(null);
  }, [member.user_id]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const directMessageUser: User = {
    id: member.user_id,
    username: member.username,
    email: member.email || '',
    display_name: member.display_name || undefined,
    avatar_url: member.avatar_url || undefined,
    is_online: member.is_online,
  };

  const openDirectMessage = async (content?: string) => {
    if (isSelf) return;
    queueDirectMessage(directMessageUser, content);
    await selectServer(0);
    onClose();
  };

  const handleSendMessage = async () => {
    const content = message.trim();
    if (!content || isSelf) return;
    setMessage('');
    await openDirectMessage(content);
  };

  const handleAddFriend = async () => {
    if (isSelf || friendStatus !== 'idle') return;
    setFriendStatus('loading');
    setFeedback(null);
    try {
      await friendService.sendFriendRequest(member.username);
      setFriendStatus('sent');
      setFeedback({ tone: 'success', text: 'Запрос в друзья отправлен' });
    } catch (error) {
      const errorMessage = getApiErrorMessage(error, 'Не удалось отправить запрос в друзья');
      if (errorMessage.toLowerCase().includes('already')) {
        setFriendStatus('sent');
        setFeedback({ tone: 'success', text: 'Вы уже друзья или запрос уже отправлен' });
      } else {
        setFriendStatus('idle');
        setFeedback({ tone: 'error', text: errorMessage });
      }
    }
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setFeedback({ tone: 'success', text: label });
      setShowMoreMenu(false);
    } catch (error) {
      console.error('Не удалось скопировать значение:', error);
      setFeedback({ tone: 'error', text: 'Не удалось скопировать' });
    }
  };

  const handleSelectEmoji = (codePoints: readonly number[]) => {
    setMessage((current) => current + String.fromCodePoint(...codePoints));
    window.requestAnimationFrame(() => messageInputRef.current?.focus());
  };

  const handleToggleRole = async (role: Role, add: boolean) => {
    if (!canManageMemberRoles || busyRoleId !== null) return;
    const roleIsManageable = !role.is_default && (isOwner || role.position < topRolePosition);
    if (!roleIsManageable) return;

    setBusyRoleId(role.id);
    setFeedback(null);
    try {
      if (add) {
        await serverService.addMemberRole(serverId, member.user_id, role.id);
      } else {
        await serverService.removeMemberRole(serverId, member.user_id, role.id);
      }
      const nextRoleIds = add
        ? [...member.role_ids, role.id]
        : member.role_ids.filter((id) => id !== role.id);
      const nextRoles = roles.filter((roleItem) => nextRoleIds.includes(roleItem.id));
      const nextColor = nextRoles.find((roleItem) => roleItem.color)?.color || null;
      const nextTop = member.is_owner
        ? member.top_role_position
        : Math.max(...nextRoles.map((roleItem) => roleItem.position), 0);

      onMemberUpdated?.({
        ...member,
        role_ids: nextRoleIds,
        roles: nextRoles,
        color: nextColor,
        top_role_position: nextTop,
      });
    } catch (error) {
      console.error('Не удалось изменить роль участника:', error);
      setFeedback({ tone: 'error', text: getApiErrorMessage(error, 'Не удалось изменить роль участника') });
    } finally {
      setBusyRoleId(null);
    }
  };

  const avatarUser = {
    username: member.username,
    display_name: member.display_name || undefined,
    avatar_url: resolveMediaUrl(member.avatar_url),
  };

  return createPortal(
    <div
      ref={popoverRef}
      className="member-profile-popover fixed z-[120] max-h-[calc(100vh-24px)] overflow-y-auto rounded-lg border border-[#3e3f45] bg-[#232428] shadow-2xl"
      style={{
        top: position.top,
        left: position.left,
        width: POPOVER_WIDTH,
      }}
      role="dialog"
      aria-label={`Профиль ${displayName}`}
    >
      <div className="relative h-[60px]" style={{ backgroundColor: bannerColor }}>
        <div className="absolute right-2 top-2 flex items-center gap-1">
          {!isSelf && (
            <Tooltip content={friendStatus === 'sent' ? 'Запрос отправлен' : 'Добавить в друзья'}>
              <span className="inline-flex">
                <button
                  type="button"
                  onClick={() => void handleAddFriend()}
                  disabled={friendStatus !== 'idle'}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-black/20 hover:text-white disabled:cursor-default disabled:opacity-70"
                  aria-label={friendStatus === 'sent' ? 'Запрос отправлен' : 'Добавить в друзья'}
                >
                  {friendStatus === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : friendStatus === 'sent' ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                </button>
              </span>
            </Tooltip>
          )}
          <div className="relative">
            <Tooltip content="Дополнительные действия">
              <button
                type="button"
                onClick={() => {
                  setShowMoreMenu((current) => !current);
                  setShowEmojiPicker(false);
                  setShowRolePicker(false);
                }}
                className={cn('flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-black/20 hover:text-white', showMoreMenu && 'bg-black/20 text-white')}
                aria-label="Дополнительные действия"
                aria-expanded={showMoreMenu}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </Tooltip>
            {showMoreMenu && (
              <div className="absolute right-0 top-9 z-[140] w-56 rounded-md border border-[#3e3f45] bg-[#111214] p-1 shadow-xl">
                {!isSelf && (
                  <button type="button" onClick={() => void openDirectMessage()} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-[#35373c]">
                    <MessageSquare className="h-4 w-4" />Написать сообщение
                  </button>
                )}
                {!isSelf && friendStatus !== 'sent' && (
                  <button type="button" disabled={friendStatus === 'loading'} onClick={() => { setShowMoreMenu(false); void handleAddFriend(); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-[#35373c] disabled:opacity-50">
                    <UserPlus className="h-4 w-4" />Добавить в друзья
                  </button>
                )}
                <button type="button" onClick={() => void handleCopy(member.username, 'Имя пользователя скопировано')} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-[#35373c]">
                  <Copy className="h-4 w-4" />Копировать имя
                </button>
                <button type="button" onClick={() => void handleCopy(String(member.user_id), 'ID пользователя скопирован')} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-[#35373c]">
                  <Copy className="h-4 w-4" />Копировать ID
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative px-4 pb-4">
        <div className="absolute -top-[34px] left-4">
          <div className="relative">
            <UserAvatar user={avatarUser} size={80} className="border-[6px] border-[#232428]" />
            <span
              className={cn(
                'absolute bottom-1 right-1 h-4 w-4 rounded-full border-[3px] border-[#232428]',
                member.is_online ? 'bg-green-500' : 'bg-[#747f8d]'
              )}
            />
          </div>
        </div>

        <div className="pt-12">
          <h3
            className="truncate text-xl font-bold text-foreground"
            style={member.color ? { color: member.color } : undefined}
          >
            {displayName}
          </h3>
          <p className="truncate text-sm text-muted-foreground">@{member.username}</p>
          {isSelf && (
            <button
              type="button"
              onClick={() => {
                onClose();
                openUserSettings('profile');
              }}
              className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#3a3c43] px-3 text-sm font-semibold text-foreground transition-colors hover:bg-[#44464e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Pencil className="h-4 w-4" />
              Редактировать профиль
            </button>
          )}
          {feedback && (
            <p className={cn('mt-2 text-xs', feedback.tone === 'success' ? 'text-green-400' : 'text-red-400')} role="status">
              {feedback.text}
            </p>
          )}
        </div>

        {(member.roles.length > 0 || (canManageMemberRoles && assignableRoles.length > 0)) && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Роли</p>
            <div className="flex flex-wrap gap-1.5">
              {member.roles.map((role) => {
                const removable = canManageMemberRoles && !role.is_default && (isOwner || role.position < topRolePosition);
                return (
                  <span key={role.id} className="flex max-w-full items-center gap-1 rounded-full border border-[#3e3f45] bg-[#2b2d31] px-2 py-0.5 text-xs text-foreground">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: role.color || '#949ba4' }} />
                    <span className="truncate">{role.name}</span>
                    {removable && (
                      <button type="button" disabled={busyRoleId === role.id} aria-label={`Убрать роль ${role.name}`} onClick={() => void handleToggleRole(role, false)} className="ml-0.5 text-muted-foreground transition-colors hover:text-red-400 disabled:opacity-50">
                        {busyRoleId === role.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                      </button>
                    )}
                  </span>
                );
              })}
              {canManageMemberRoles && assignableRoles.length > 0 && (
                <button type="button" disabled={busyRoleId !== null} onClick={() => { setShowRolePicker((current) => !current); setShowMoreMenu(false); setShowEmojiPicker(false); }} aria-label="Добавить роль" aria-expanded={showRolePicker} className={cn('flex items-center gap-1 rounded-full border border-dashed border-[#3e3f45] px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50', showRolePicker && 'border-primary text-foreground')}>
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
            {showRolePicker && assignableRoles.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-[#3e3f45] bg-[#111214] p-1 shadow-lg">
                {assignableRoles.map((role) => (
                  <button key={role.id} type="button" disabled={busyRoleId !== null} onClick={() => { setShowRolePicker(false); void handleToggleRole(role, true); }} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-[#35373c] disabled:opacity-50">
                    <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: role.color || '#949ba4' }} />
                    <span className="truncate">{role.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!isSelf && (
          <div className="mt-4">
            {showEmojiPicker && (
              <div className="mb-2 grid grid-cols-9 gap-1 rounded-md border border-[#3e3f45] bg-[#111214] p-2 shadow-lg">
                {EMOJI_CODE_POINTS.map((codePoints) => {
                  const emoji = String.fromCodePoint(...codePoints);
                  return (
                    <button key={codePoints.join('-')} type="button" onClick={() => handleSelectEmoji(codePoints)} className="flex h-7 w-7 items-center justify-center rounded text-lg transition-colors hover:bg-[#35373c]" aria-label="Вставить смайлик">
                      {emoji}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-2 rounded-md bg-[#383a40] px-3 py-2">
              <input
                ref={messageInputRef}
                type="text"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSendMessage(); } }}
                placeholder={`Сообщение для @${displayName}`}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <Tooltip content="Выбрать смайлик">
                <button
                  type="button"
                  onClick={() => { setShowEmojiPicker((current) => !current); setShowMoreMenu(false); setShowRolePicker(false); }}
                  className={cn('flex-none text-muted-foreground transition-colors hover:text-foreground', showEmojiPicker && 'text-foreground')}
                  aria-label="Выбрать смайлик"
                  aria-expanded={showEmojiPicker}
                >
                  <Smile className="h-5 w-5" />
                </button>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
