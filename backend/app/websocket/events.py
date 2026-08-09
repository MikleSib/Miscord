"""Канонические имена пользовательских WebSocket-событий.

Этот список должен совпадать с frontend/src/lib/gatewayEvents.ts.
Тест backend/tests/test_gateway_events_registry.py проверяет совпадение.
"""

from __future__ import annotations

# Системные / keepalive
PING = "ping"
PONG = "pong"
HEARTBEAT_ACK = "heartbeat_ack"
ERROR = "error"
RATE_LIMIT = "rate_limit"
SLOW_MODE = "slow_mode"

# Чат
NEW_MESSAGE = "new_message"
MESSAGE_EDITED = "message_edited"
MESSAGE_UPDATED = "message_updated"
MESSAGE_DELETED = "message_deleted"
MESSAGE_ACK = "message_ack"
MESSAGE_SEND_FAILED = "message_send_failed"
TYPING = "typing"
REACTION_UPDATED = "reaction_updated"
CHANNEL_PINS_UPDATED = "channel_pins_updated"

# DM
DM = "dm"
DM_DELETED = "dm_deleted"
DM_REACTION_UPDATED = "dm_reaction_updated"

# Серверы и каналы
SERVER_CREATED = "server_created"
SERVER_UPDATED = "server_updated"
SERVER_DELETED = "server_deleted"
SERVER_REMOVED = "server_removed"
TEXT_CHANNEL_CREATED = "text_channel_created"
VOICE_CHANNEL_CREATED = "voice_channel_created"
TEXT_CHANNEL_UPDATED = "text_channel_updated"
VOICE_CHANNEL_UPDATED = "voice_channel_updated"
TEXT_CHANNEL_DELETED = "text_channel_deleted"
VOICE_CHANNEL_DELETED = "voice_channel_deleted"
USER_JOINED_CHANNEL = "user_joined_channel"
USER_LEFT_CHANNEL = "user_left_channel"
CHANNEL_CATEGORY_CREATED = "channel_category_created"
CHANNEL_CATEGORY_UPDATED = "channel_category_updated"
CHANNEL_CATEGORY_DELETED = "channel_category_deleted"
CHANNEL_POSITIONS_UPDATED = "channel_positions_updated"

# Роли / участники
SERVER_MEMBER_UPDATED = "server_member_updated"
SERVER_MEMBER_ROLES_UPDATED = "server_member_roles_updated"
SERVER_ROLE_CREATED = "server_role_created"
SERVER_ROLE_UPDATED = "server_role_updated"
SERVER_ROLE_DELETED = "server_role_deleted"
SERVER_ROLES_REORDERED = "server_roles_reordered"
SERVER_OWNERSHIP_TRANSFERRED = "server_ownership_transferred"

# Приглашения
SERVER_INVITE = "server_invite"
SERVER_INVITE_CREATED = "server_invite_created"
SERVER_INVITE_DELETED = "server_invite_deleted"
# Legacy alias (клиент ещё слушает)
CHANNEL_INVITATION = "channel_invitation"

# Presence / профиль
USER_STATUS_CHANGED = "user_status_changed"
USER_PROFILE_UPDATED = "user_profile_updated"

# Уведомления
CHANNEL_MESSAGE = "channel_message"
MENTION = "mention"

# Друзья
NEW_FRIEND_REQUEST = "new_friend_request"
FRIEND_REQUEST_ACCEPTED = "friend_request_accepted"
FRIEND_REQUEST_REJECTED = "friend_request_rejected"
FRIEND_REMOVED = "friend_removed"

# Голос
VOICE_JOINED = "voice_joined"
USER_JOINED_VOICE = "user_joined_voice"
USER_LEFT_VOICE = "user_left_voice"
VOICE_CHANNEL_JOIN = "voice_channel_join"
VOICE_CHANNEL_LEAVE = "voice_channel_leave"
USER_MUTED = "user_muted"
USER_DEAFENED = "user_deafened"
VOICE_SPEAKING = "voice_speaking"
SCREEN_SHARE_STARTED = "screen_share_started"
SCREEN_SHARE_STOPPED = "screen_share_stopped"
SCREEN_SHARE_VIEWER_JOINED = "screen_share_viewer_joined"
VOICE_MEDIA_TICKET_REFRESH = "voice_media_ticket_refresh"
VOICE_DEBUG = "voice_debug"

# Боты / UI
INTERACTION_MODAL = "interaction_modal"
WEBHOOKS_UPDATED = "webhooks_updated"

USER_GATEWAY_EVENTS: frozenset[str] = frozenset(
    {
        PING,
        PONG,
        HEARTBEAT_ACK,
        ERROR,
        RATE_LIMIT,
        SLOW_MODE,
        NEW_MESSAGE,
        MESSAGE_EDITED,
        MESSAGE_UPDATED,
        MESSAGE_DELETED,
        MESSAGE_ACK,
        MESSAGE_SEND_FAILED,
        TYPING,
        REACTION_UPDATED,
        CHANNEL_PINS_UPDATED,
        DM,
        DM_DELETED,
        DM_REACTION_UPDATED,
        SERVER_CREATED,
        SERVER_UPDATED,
        SERVER_DELETED,
        SERVER_REMOVED,
        TEXT_CHANNEL_CREATED,
        VOICE_CHANNEL_CREATED,
        TEXT_CHANNEL_UPDATED,
        VOICE_CHANNEL_UPDATED,
        TEXT_CHANNEL_DELETED,
        VOICE_CHANNEL_DELETED,
        USER_JOINED_CHANNEL,
        USER_LEFT_CHANNEL,
        CHANNEL_CATEGORY_CREATED,
        CHANNEL_CATEGORY_UPDATED,
        CHANNEL_CATEGORY_DELETED,
        CHANNEL_POSITIONS_UPDATED,
        SERVER_MEMBER_UPDATED,
        SERVER_MEMBER_ROLES_UPDATED,
        SERVER_ROLE_CREATED,
        SERVER_ROLE_UPDATED,
        SERVER_ROLE_DELETED,
        SERVER_ROLES_REORDERED,
        SERVER_OWNERSHIP_TRANSFERRED,
        SERVER_INVITE,
        SERVER_INVITE_CREATED,
        SERVER_INVITE_DELETED,
        CHANNEL_INVITATION,
        USER_STATUS_CHANGED,
        USER_PROFILE_UPDATED,
        CHANNEL_MESSAGE,
        MENTION,
        NEW_FRIEND_REQUEST,
        FRIEND_REQUEST_ACCEPTED,
        FRIEND_REQUEST_REJECTED,
        FRIEND_REMOVED,
        VOICE_JOINED,
        USER_JOINED_VOICE,
        USER_LEFT_VOICE,
        VOICE_CHANNEL_JOIN,
        VOICE_CHANNEL_LEAVE,
        USER_MUTED,
        USER_DEAFENED,
        VOICE_SPEAKING,
        SCREEN_SHARE_STARTED,
        SCREEN_SHARE_STOPPED,
        SCREEN_SHARE_VIEWER_JOINED,
        VOICE_MEDIA_TICKET_REFRESH,
        VOICE_DEBUG,
        INTERACTION_MODAL,
        WEBHOOKS_UPDATED,
    }
)
