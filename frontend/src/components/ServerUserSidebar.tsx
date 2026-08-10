'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useStore } from '../lib/store';
import { UserAvatar } from './ui/user-avatar';
import { MemberProfilePopover } from './MemberProfilePopover';
import serverService from '../services/serverService';
import websocketService from '../services/websocketService';
import { cn } from '../lib/utils';
import { resolveMediaUrl } from '../lib/mediaUrl';
import { getMemberDisplayName, groupMembersByRole } from '../lib/memberListGrouping';
import { Role, ServerMember } from '../types';

type SelectedMemberState = {
  member: ServerMember;
  anchorRect: DOMRect;
};

function patchMemberOnlineStatus(members: ServerMember[], userId: number, isOnline: boolean): ServerMember[] {
  return members.map((member) =>
    member.user_id === userId ? { ...member, is_online: isOnline } : member
  );
}

function MemberRow({
  member,
  isSelected,
  dimmed = false,
  onSelect,
}: {
  member: ServerMember;
  isSelected: boolean;
  dimmed?: boolean;
  onSelect: (member: ServerMember, rect: DOMRect) => void;
}) {
  const displayName = getMemberDisplayName(member);

  return (
    <button
      type="button"
      onClick={(event) => onSelect(member, event.currentTarget.getBoundingClientRect())}
      className={cn(
        'interactive-row flex w-full items-center gap-2 px-2 py-1.5 text-left',
        dimmed && 'opacity-60',
        isSelected && 'bg-[#393a3f]'
      )}
    >
      <div className="relative flex-none">
        <UserAvatar
          user={{
            username: member.username,
            display_name: member.display_name || undefined,
            avatar_url: resolveMediaUrl(member.avatar_url),
          }}
          size={32}
        />
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#323339]',
            member.is_online ? 'bg-green-500' : 'bg-[#747f8d]'
          )}
        />
      </div>
      <span
        className="min-w-0 flex-1 truncate text-sm font-medium"
        style={member.color ? { color: member.color } : undefined}
      >
        {displayName}
      </span>
    </button>
  );
}

export function ServerUserSidebar() {
  const { currentServer } = useStore();
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<SelectedMemberState | null>(null);
  const loadRequestId = useRef(0);

  const loadMembers = useCallback(async () => {
    const serverId = currentServer?.id;
    if (!serverId) return;

    const requestId = ++loadRequestId.current;
    setIsLoading(true);
    try {
      const [membersResponse, rolesResponse] = await Promise.all([
        serverService.getMembers(serverId),
        serverService.getRoles(serverId),
      ]);
      if (requestId !== loadRequestId.current) return;
      setMembers(membersResponse.members);
      setRoles(rolesResponse);
    } catch (error) {
      if (requestId !== loadRequestId.current) return;
      console.error('Ошибка загрузки участников сервера:', error);
    } finally {
      if (requestId === loadRequestId.current) {
        setIsLoading(false);
      }
    }
  }, [currentServer?.id]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    let wasConnected = websocketService.isConnected();
    return websocketService.onConnectionStatusChange(({ isConnected }) => {
      if (isConnected && !wasConnected) {
        void loadMembers();
      }
      wasConnected = isConnected;
    });
  }, [loadMembers]);

  useEffect(() => {
    if (!currentServer?.id) return;

    const serverId = currentServer.id;

    const reloadIfCurrent = (payload: any) => {
      const eventServerId = payload?.data?.server_id ?? payload?.channel_id ?? payload?.server_id;
      if (eventServerId === serverId) {
        void loadMembers();
      }
    };

    const handleStatusChanged = (payload: any) => {
      const data = payload?.data || payload;
      if (!data?.user_id) return;
      setMembers((prev) => patchMemberOnlineStatus(prev, data.user_id, Boolean(data.is_online)));
    };

    const handleMemberJoined = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.channel_id !== serverId) return;
      void loadMembers();
    };

    const handleMemberLeft = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (detail.channel_id !== serverId) return;
      setMembers((prev) => prev.filter((member) => member.user_id !== detail.user_id));
      setSelected((prev) => (prev?.member.user_id === detail.user_id ? null : prev));
    };

    const wsEvents = [
      'user_joined_channel',
      'user_left_channel',
      'server_member_updated',
      'server_member_roles_updated',
      'server_ownership_transferred',
      'server_role_created',
      'server_role_updated',
      'server_role_deleted',
    ] as const;

    wsEvents.forEach((eventName) => websocketService.on(eventName, reloadIfCurrent));
    websocketService.on('user_status_changed', handleStatusChanged);

    window.addEventListener('server_member_joined', handleMemberJoined);
    window.addEventListener('server_member_left', handleMemberLeft);

    return () => {
      wsEvents.forEach((eventName) => websocketService.off(eventName, reloadIfCurrent));
      websocketService.off('user_status_changed', handleStatusChanged);
      window.removeEventListener('server_member_joined', handleMemberJoined);
      window.removeEventListener('server_member_left', handleMemberLeft);
    };
  }, [currentServer?.id, loadMembers]);

  const grouped = useMemo(() => groupMembersByRole(members, roles), [members, roles]);

  const handleSelectMember = (member: ServerMember, anchorRect: DOMRect) => {
    setSelected({ member, anchorRect });
  };

  const handleMemberUpdated = (updatedMember: ServerMember) => {
    setMembers((prev) =>
      prev.map((member) => (member.user_id === updatedMember.user_id ? updatedMember : member))
    );
    setSelected((prev) =>
      prev?.member.user_id === updatedMember.user_id ? { ...prev, member: updatedMember } : prev
    );
  };

  if (!currentServer) {
    return null;
  }

  return (
    <>
      <div className="server-members-panel relative flex h-full w-60 flex-col overflow-hidden border-l border-[#3e3f45] bg-[#323339]">
        <div className="server-members-panel__header app-header border-b px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Участники сервера — {members.length}
        </div>

        <div className="server-members-panel__list flex-1 overflow-y-auto p-2 space-y-4">
          {isLoading && members.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Загрузка...
            </div>
          ) : (
            <>
              {grouped.roleGroups.map((group) => {
                const title = group.role ? group.role.name : 'Онлайн';
                const titleColor = group.role?.color;

                return (
                  <div key={group.role?.id ?? 'online-default'}>
                    <div
                      className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide"
                      style={titleColor ? { color: titleColor } : undefined}
                    >
                      {title} — {group.members.length}
                    </div>
                    {group.members.map((member) => (
                      <MemberRow
                        key={member.user_id}
                        member={member}
                        isSelected={selected?.member.user_id === member.user_id}
                        dimmed={!member.is_online}
                        onSelect={handleSelectMember}
                      />
                    ))}
                  </div>
                );
              })}

              <div>
                <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Не в сети — {grouped.offline.length}
                </div>
                {grouped.offline.length === 0 ? (
                  <div className="px-2 text-xs text-muted-foreground">Все в сети</div>
                ) : (
                  grouped.offline.map((member) => (
                    <MemberRow
                      key={member.user_id}
                      member={member}
                      isSelected={selected?.member.user_id === member.user_id}
                      dimmed
                      onSelect={handleSelectMember}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {selected && currentServer && (
        <MemberProfilePopover
          member={selected.member}
          serverId={currentServer.id}
          roles={roles}
          anchorRect={selected.anchorRect}
          onClose={() => setSelected(null)}
          onMemberUpdated={handleMemberUpdated}
        />
      )}
    </>
  );
}
