export interface User {
  id: number;
  username: string;
  email: string;
  display_name?: string;
  avatar_url?: string;
  is_active?: boolean;
  is_online?: boolean;
  created_at?: string;
  updated_at?: string;
  is_muted?: boolean;
  is_deafened?: boolean;
  request_id?: number;
  last_message_at?: string | null;
  is_friend?: boolean;
  is_bot?: boolean;
  is_webhook?: boolean;
}

export interface FriendRequest {
  request_id: number;
  from_user: User;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface Server {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  banner?: string | null;
  is_public?: boolean;
  owner_id?: number;
  created_at?: string;
  members_count?: number;
  channels: Channel[];
}

// --- Управление сервером Miscord ---

export interface Role {
  id: number;
  server_id: number;
  name: string;
  color?: string | null;
  position: number;
  permissions: number;
  is_default: boolean;
  created_at?: string | null;
  members_count?: number;
}

export interface ServerMember {
  id: number;
  user_id: number;
  username: string;
  display_name?: string | null;
  nickname?: string | null;
  email?: string;
  avatar_url?: string | null;
  is_online?: boolean;
  is_active?: boolean;
  is_owner: boolean;
  joined_at?: string | null;
  roles: Role[];
  role_ids: number[];
  color?: string | null;
  top_role_position: number;
  permissions: number;
}

export interface ServerBan {
  id: number;
  user_id: number;
  reason?: string | null;
  created_at?: string | null;
  user?: {
    id: number;
    username: string;
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
  moderator?: {
    id: number;
    username: string;
  } | null;
}

export interface ServerInvite {
  id: number;
  code: string;
  server_id: number;
  inviter_id?: number | null;
  inviter?: {
    id: number;
    username: string;
    avatar_url?: string | null;
  } | null;
  target_text_channel_id?: number | null;
  max_uses?: number | null;
  uses: number;
  expires_at?: string | null;
  created_at?: string | null;
  is_expired: boolean;
}

export interface InvitePreview {
  code: string;
  server_id: number;
  server_name: string;
  server_icon?: string | null;
  server_description?: string | null;
  members_count: number;
  online_count: number;
  inviter_name?: string | null;
  is_expired: boolean;
  is_member: boolean;
  is_banned: boolean;
  expires_at?: string | null;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  target_type?: string | null;
  target_id?: number | null;
  target_name?: string | null;
  changes?: Record<string, any> | null;
  reason?: string | null;
  created_at?: string | null;
  actor?: {
    id: number;
    username: string;
    avatar_url?: string | null;
  } | null;
}

export interface PermissionCatalogItem {
  key: string;
  value: number;
  label: string;
  description: string;
  group: string;
}

export interface PermissionCatalog {
  permissions: PermissionCatalogItem[];
  groups: Array<{ key: string; label: string }>;
  all: number;
  default: number;
}

export interface ServerMembershipInfo {
  server_id: number;
  user_id: number;
  is_owner: boolean;
  permissions: number;
  top_role_position: number;
  roles: Role[];
}

export type ServerNotificationLevel = 'all' | 'mentions' | 'nothing'
export type ChannelNotificationLevel = 'all' | 'mentions' | 'nothing' | 'muted'

export interface ChannelNotificationOverride {
  text_channel_id: number
  level: ChannelNotificationLevel
}

export interface ServerNotificationSettings {
  server_id: number
  muted: boolean
  notification_level: ServerNotificationLevel
  suppress_everyone: boolean
  suppress_roles: boolean
  suppress_highlights: boolean
  mute_events: boolean
  mobile_push: boolean
  channel_overrides: ChannelNotificationOverride[]
}

export interface ChannelPermissionCatalogItem {
  key: string;
  value: number;
  label: string;
  description: string;
  group?: string;
}

export interface ChannelPermissionOverwrite {
  id: number;
  target_type: 'role' | 'member';
  target_id: number;
  allow: number;
  deny: number;
  target_name: string;
  target_color?: string | null;
  target_avatar_url?: string | null;
  is_default_role?: boolean;
}

export interface Channel {
  id: number;
  name: string;
  type: 'text' | 'voice';
  kind?: 'text' | 'forum' | 'public_thread' | 'private_thread' | 'forum_post';
  parent_id?: number | null;
  serverId: number;
  position?: number;
  category_id?: number | null;
  slow_mode_seconds?: number;
  max_users?: number; // Для голосовых каналов, 0 = без лимита
  bitrate?: number; // кбит/с, 8–96
  video_quality?: 'auto' | '720p';
}

export interface Attachment {
  id: number;
  file_url: string;
  message_id: number;
  filename?: string;
  content_type?: string;
  size_bytes?: number;
}

export interface Reaction {
  id: number;
  emoji: string;
  count: number;
  users: User[];
  currentUserReacted: boolean;
}

/** Превью ссылки (Open Graph / картинка / сайт / видео) */
export interface LinkEmbed {
  url: string;
  type: 'link' | 'image' | 'video';
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  site_name?: string | null;
  favicon_url?: string | null;
  /** Для YouTube и похожих */
  video_id?: string | null;
  embed_url?: string | null;
}

export interface Message {
  id: number;
  content: string | null;
  author: User;
  timestamp: string;
  client_nonce?: string | null;
  channelId?: number; // Для сообщений в каналах
  is_edited?: boolean;
  is_deleted?: boolean;
  pinned?: boolean;
  pinned_at?: string | null;
  attachments: Attachment[];
  reactions?: Reaction[];
  reply_to?: Message; // Ответ на сообщение
  sender_id?: number; // Для личных сообщений
  recipient_id?: number; // Для личных сообщений
  embeds?: LinkEmbed[];
  flags?: number;
  components?: Array<Record<string, any>>;
  poll?: import('./community').Poll | null;
  message_type?: number;
  application_id?: string | null;
  interaction_metadata?: Record<string, any> | null;
  ephemeral?: boolean;
}

export interface DirectMessage {
  id: number | string; // Может быть временным ID (строка) для pending сообщений
  content: string;
  timestamp: string;
  client_nonce?: string | null;
  sender_id: number;
  recipient_id: number;
  author?: User; // Данные автора (могут прийти с сервера)
  attachments?: Attachment[];
  reactions?: Reaction[];
  isPending?: boolean; // Статус отправки
  tempId?: string; // Временный ID для отслеживания pending сообщений
}

// Бэкенд типы (для API)
export interface BackendChannel {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  banner?: string | null;
  is_public?: boolean;
  owner_id: number;
  owner?: User;
  created_at: string;
  updated_at?: string;
  text_channels?: TextChannel[];
  voice_channels?: VoiceChannel[];
  members_count?: number;
  members?: User[];
  channels?: Array<{
    id: number;
    name: string;
    type: 'text' | 'voice';
    position: number;
    slow_mode_seconds?: number;
    max_users?: number;
  }>;
}

export interface TextChannel {
  id: number;
  name: string;
  kind?: 'text' | 'forum' | 'public_thread' | 'private_thread' | 'forum_post';
  parent_id?: number | null;
  channel_id: number;
  position: number;
  category_id?: number | null;
  slow_mode_seconds?: number;
  created_at?: string;
}

export interface VoiceChannel {
  id: number;
  name: string;
  channel_id: number;
  position: number;
  category_id?: number | null;
  max_users: number;
  bitrate?: number;
  video_quality?: 'auto' | '720p';
  created_at?: string;
  active_users_count?: number;
}

export interface AuthTokens {
  access_token: string;
  token_type: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  display_name: string;
  email: string;
  password: string;
}

export interface VoiceUser {
  user_id: number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  is_muted: boolean;
  is_deafened: boolean;
}

export interface FullTextChannel {
  id: number;
  name: string;
  position: number;
  created_at: string;
  messages: Message[];
}

export interface FullVoiceChannel {
  id: number;
  name: string;
  position: number;
  max_users: number;
  bitrate?: number;
  video_quality?: 'auto' | '720p';
  created_at: string;
  active_users: Array<{
    id: number;
    username: string;
    is_muted: boolean;
    is_deafened: boolean;
  }>;
}

export interface FullServer {
  id: number;
  name: string;
  description?: string;
  owner_id: number;
  created_at: string;
  updated_at?: string;
  owner: User;
  members: User[];
  text_channels: FullTextChannel[];
  voice_channels: FullVoiceChannel[];
}

export interface FullServerData {
  servers: FullServer[];
}
