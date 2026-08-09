/** Miscord API v1 permission values. Keep numbers for the existing internal
 * API, but always perform bitwise operations with BigInt: JavaScript's normal
 * bitwise operators truncate values to signed 32 bits. */
export const Permissions = {
  CREATE_INSTANT_INVITE: 2 ** 0,
  KICK_MEMBERS: 2 ** 1,
  BAN_MEMBERS: 2 ** 2,
  ADMINISTRATOR: 2 ** 3,
  MANAGE_CHANNELS: 2 ** 4,
  MANAGE_GUILD: 2 ** 5,
  ADD_REACTIONS: 2 ** 6,
  VIEW_AUDIT_LOG: 2 ** 7,
  PRIORITY_SPEAKER: 2 ** 8,
  STREAM: 2 ** 9,
  VIEW_CHANNEL: 2 ** 10,
  SEND_MESSAGES: 2 ** 11,
  SEND_TTS_MESSAGES: 2 ** 12,
  MANAGE_MESSAGES: 2 ** 13,
  EMBED_LINKS: 2 ** 14,
  ATTACH_FILES: 2 ** 15,
  READ_MESSAGE_HISTORY: 2 ** 16,
  MENTION_EVERYONE: 2 ** 17,
  USE_EXTERNAL_EMOJIS: 2 ** 18,
  VIEW_GUILD_INSIGHTS: 2 ** 19,
  CONNECT: 2 ** 20,
  SPEAK: 2 ** 21,
  MUTE_MEMBERS: 2 ** 22,
  DEAFEN_MEMBERS: 2 ** 23,
  MOVE_MEMBERS: 2 ** 24,
  USE_VAD: 2 ** 25,
  CHANGE_NICKNAME: 2 ** 26,
  MANAGE_NICKNAMES: 2 ** 27,
  MANAGE_ROLES: 2 ** 28,
  MANAGE_WEBHOOKS: 2 ** 29,
  MANAGE_GUILD_EXPRESSIONS: 2 ** 30,
  USE_APPLICATION_COMMANDS: 2 ** 31,
  REQUEST_TO_SPEAK: 2 ** 32,
  MANAGE_EVENTS: 2 ** 33,
  MANAGE_THREADS: 2 ** 34,
  CREATE_PUBLIC_THREADS: 2 ** 35,
  CREATE_PRIVATE_THREADS: 2 ** 36,
  USE_EXTERNAL_STICKERS: 2 ** 37,
  SEND_MESSAGES_IN_THREADS: 2 ** 38,
  USE_EMBEDDED_ACTIVITIES: 2 ** 39,
  MODERATE_MEMBERS: 2 ** 40,
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 2 ** 41,
  USE_SOUNDBOARD: 2 ** 42,
  CREATE_GUILD_EXPRESSIONS: 2 ** 43,
  CREATE_EVENTS: 2 ** 44,
  USE_EXTERNAL_SOUNDS: 2 ** 45,
  SEND_VOICE_MESSAGES: 2 ** 46,
  SET_VOICE_CHANNEL_STATUS: 2 ** 48,
  SEND_POLLS: 2 ** 49,
  USE_EXTERNAL_APPS: 2 ** 50,
  PIN_MESSAGES: 2 ** 51,
  BYPASS_SLOWMODE: 2 ** 52,

  CREATE_INVITE: 2 ** 0,
  VIEW_CHANNELS: 2 ** 10,
  MANAGE_SERVER: 2 ** 5,
  MANAGE_PERMISSIONS: 2 ** 28,
  MANAGE_INVITES: 2 ** 5,
} as const

export type PermissionKey = keyof typeof Permissions
export type PermissionInput = number | string | bigint | null | undefined

function asBigInt(value: PermissionInput): bigint {
  if (value === null || value === undefined || value === '') return BigInt(0)
  try {
    return BigInt(value)
  } catch {
    return BigInt(0)
  }
}

function asSafeNumber(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error('Permission bitfield exceeds Number.MAX_SAFE_INTEGER')
  return result
}

export function hasRawPermission(permissions: PermissionInput, permission: PermissionInput): boolean {
  const mask = asBigInt(permission)
  return mask !== BigInt(0) && (asBigInt(permissions) & mask) === mask
}

export function hasPermission(permissions: PermissionInput, permission: PermissionInput): boolean {
  if (hasRawPermission(permissions, Permissions.ADMINISTRATOR)) return true
  return hasRawPermission(permissions, permission)
}

export function togglePermission(permissions: PermissionInput, permission: PermissionInput, enabled: boolean): number {
  const current = asBigInt(permissions)
  const mask = asBigInt(permission)
  return asSafeNumber(enabled ? current | mask : current & ~mask)
}

export function missingPermissions(desired: PermissionInput, own: PermissionInput): number {
  if (hasRawPermission(own, Permissions.ADMINISTRATOR)) return 0
  return asSafeNumber(asBigInt(desired) & ~asBigInt(own))
}

export function permissionBitfield(value: PermissionInput): bigint {
  return asBigInt(value)
}
