/**
 * Канонические имена пользовательских WebSocket-событий.
 * Должен совпадать с backend/app/websocket/events.py.
 * Проверка: backend/tests/test_gateway_events_registry.py
 */

export const GatewayEvents = {
  PING: 'ping',
  PONG: 'pong',
  HEARTBEAT_ACK: 'heartbeat_ack',
  ERROR: 'error',
  RATE_LIMIT: 'rate_limit',
  SLOW_MODE: 'slow_mode',

  NEW_MESSAGE: 'new_message',
  MESSAGE_EDITED: 'message_edited',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_DELETED: 'message_deleted',
  MESSAGE_ACK: 'message_ack',
  MESSAGE_SEND_FAILED: 'message_send_failed',
  TYPING: 'typing',
  REACTION_UPDATED: 'reaction_updated',
  CHANNEL_PINS_UPDATED: 'channel_pins_updated',

  DM: 'dm',
  DM_DELETED: 'dm_deleted',
  DM_REACTION_UPDATED: 'dm_reaction_updated',

  SERVER_CREATED: 'server_created',
  SERVER_UPDATED: 'server_updated',
  SERVER_DELETED: 'server_deleted',
  SERVER_REMOVED: 'server_removed',
  TEXT_CHANNEL_CREATED: 'text_channel_created',
  VOICE_CHANNEL_CREATED: 'voice_channel_created',
  TEXT_CHANNEL_UPDATED: 'text_channel_updated',
  VOICE_CHANNEL_UPDATED: 'voice_channel_updated',
  TEXT_CHANNEL_DELETED: 'text_channel_deleted',
  VOICE_CHANNEL_DELETED: 'voice_channel_deleted',
  USER_JOINED_CHANNEL: 'user_joined_channel',
  USER_LEFT_CHANNEL: 'user_left_channel',
  CHANNEL_CATEGORY_CREATED: 'channel_category_created',
  CHANNEL_CATEGORY_UPDATED: 'channel_category_updated',
  CHANNEL_CATEGORY_DELETED: 'channel_category_deleted',
  CHANNEL_POSITIONS_UPDATED: 'channel_positions_updated',

  SERVER_MEMBER_UPDATED: 'server_member_updated',
  SERVER_MEMBER_ROLES_UPDATED: 'server_member_roles_updated',
  SERVER_ROLE_CREATED: 'server_role_created',
  SERVER_ROLE_UPDATED: 'server_role_updated',
  SERVER_ROLE_DELETED: 'server_role_deleted',
  SERVER_ROLES_REORDERED: 'server_roles_reordered',
  SERVER_OWNERSHIP_TRANSFERRED: 'server_ownership_transferred',

  SERVER_INVITE: 'server_invite',
  SERVER_INVITE_CREATED: 'server_invite_created',
  SERVER_INVITE_DELETED: 'server_invite_deleted',
  /** Legacy alias — клиент слушает оба имени. */
  CHANNEL_INVITATION: 'channel_invitation',

  USER_STATUS_CHANGED: 'user_status_changed',
  USER_PROFILE_UPDATED: 'user_profile_updated',

  CHANNEL_MESSAGE: 'channel_message',
  MENTION: 'mention',

  NEW_FRIEND_REQUEST: 'new_friend_request',
  FRIEND_REQUEST_ACCEPTED: 'friend_request_accepted',
  FRIEND_REQUEST_REJECTED: 'friend_request_rejected',
  FRIEND_REMOVED: 'friend_removed',

  VOICE_JOINED: 'voice_joined',
  USER_JOINED_VOICE: 'user_joined_voice',
  USER_LEFT_VOICE: 'user_left_voice',
  VOICE_CHANNEL_JOIN: 'voice_channel_join',
  VOICE_CHANNEL_LEAVE: 'voice_channel_leave',
  USER_MUTED: 'user_muted',
  USER_DEAFENED: 'user_deafened',
  VOICE_SPEAKING: 'voice_speaking',
  SCREEN_SHARE_STARTED: 'screen_share_started',
  SCREEN_SHARE_STOPPED: 'screen_share_stopped',
  SCREEN_SHARE_VIEWER_JOINED: 'screen_share_viewer_joined',
  VOICE_MEDIA_TICKET_REFRESH: 'voice_media_ticket_refresh',
  VOICE_DEBUG: 'voice_debug',

  INTERACTION_MODAL: 'interaction_modal',
  WEBHOOKS_UPDATED: 'webhooks_updated',

  THREAD_CREATE: 'THREAD_CREATE',
  THREAD_UPDATE: 'THREAD_UPDATE',
  THREAD_DELETE: 'THREAD_DELETE',
  THREAD_MEMBER_UPDATE: 'THREAD_MEMBER_UPDATE',
  FORUM_CREATE: 'FORUM_CREATE',
  FORUM_UPDATE: 'FORUM_UPDATE',
  POLL_STATE_UPDATE: 'POLL_STATE_UPDATE',
  NOTIFICATION_CREATE: 'NOTIFICATION_CREATE',
  NOTIFICATION_UPDATE: 'NOTIFICATION_UPDATE',
  NOTIFICATION_DELETE: 'NOTIFICATION_DELETE',
  NOTIFICATION_READ_ALL: 'NOTIFICATION_READ_ALL',
  SERVER_TEMPLATE_CREATED: 'SERVER_TEMPLATE_CREATED',
} as const

export type GatewayEventName = (typeof GatewayEvents)[keyof typeof GatewayEvents]

export const USER_GATEWAY_EVENTS: readonly GatewayEventName[] = Object.values(GatewayEvents)
