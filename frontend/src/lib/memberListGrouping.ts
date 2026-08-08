import { Role, ServerMember } from '../types';

export type MemberListGroup = {
  role: Role | null;
  members: ServerMember[];
};

export type GroupedMembers = {
  roleGroups: MemberListGroup[];
  offline: ServerMember[];
};

function getDisplayName(member: ServerMember): string {
  return member.nickname || member.display_name || member.username;
}

function sortMembers(members: ServerMember[]): ServerMember[] {
  return [...members].sort((a, b) => {
    if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
    if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
    if (a.top_role_position !== b.top_role_position) {
      return b.top_role_position - a.top_role_position;
    }
    return getDisplayName(a).localeCompare(getDisplayName(b), 'ru');
  });
}

function getHighestNonDefaultRole(member: ServerMember): Role | null {
  const nonDefault = (member.roles || []).filter((role) => !role.is_default);
  if (nonDefault.length === 0) return null;
  return nonDefault.reduce((best, role) => (role.position > best.position ? role : best));
}

/** Группировка участников по высшей роли с секцией «Не в сети» внизу. */
export function groupMembersByRole(members: ServerMember[], roles: Role[]): GroupedMembers {
  const displayRoles = roles
    .filter((role) => !role.is_default)
    .sort((a, b) => b.position - a.position);

  const assigned = new Set<number>();
  const roleGroups: MemberListGroup[] = [];

  // В секции роли — и онлайн, и офлайн (офлайн затемняются в UI)
  for (const role of displayRoles) {
    const groupMembers = members.filter((member) => {
      if (assigned.has(member.user_id)) return false;
      const highest = getHighestNonDefaultRole(member);
      return highest?.id === role.id;
    });

    if (groupMembers.length > 0) {
      groupMembers.forEach((member) => assigned.add(member.user_id));
      roleGroups.push({ role, members: sortMembers(groupMembers) });
    }
  }

  // Без роли, но в сети — секция «Онлайн»
  const remainingOnline = members.filter(
    (member) => !assigned.has(member.user_id) && member.is_online
  );
  if (remainingOnline.length > 0) {
    remainingOnline.forEach((member) => assigned.add(member.user_id));
    roleGroups.push({ role: null, members: sortMembers(remainingOnline) });
  }

  // «Не в сети» — только без ролей (кроме @everyone)
  const offline = members.filter(
    (member) => !assigned.has(member.user_id) && !member.is_online
  );

  return {
    roleGroups,
    offline: sortMembers(offline),
  };
}

export function getMemberDisplayName(member: ServerMember): string {
  return getDisplayName(member);
}
