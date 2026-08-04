/** Права сервера. Значения должны совпадать с backend/app/core/permissions.py */

export const Permissions = {
  VIEW_CHANNELS: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  MANAGE_SERVER: 1 << 4,
  MANAGE_ROLES: 1 << 5,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  CREATE_INVITE: 1 << 8,
  MANAGE_INVITES: 1 << 9,
  VIEW_AUDIT_LOG: 1 << 10,
  MANAGE_NICKNAMES: 1 << 11,
  MUTE_MEMBERS: 1 << 12,
  DEAFEN_MEMBERS: 1 << 13,
  MOVE_MEMBERS: 1 << 14,
  ADMINISTRATOR: 1 << 15,
} as const

export type PermissionKey = keyof typeof Permissions

export function hasPermission(permissions: number | undefined | null, permission: number): boolean {
  if (!permissions) return false
  if ((permissions & Permissions.ADMINISTRATOR) !== 0) return true
  return (permissions & permission) !== 0
}

export function togglePermission(permissions: number, permission: number, enabled: boolean): number {
  return enabled ? permissions | permission : permissions & ~permission
}

/** Права, которые нельзя выдать, если их нет у самого пользователя. */
export function missingPermissions(desired: number, own: number): number {
  if ((own & Permissions.ADMINISTRATOR) !== 0) return 0
  return desired & ~own
}
