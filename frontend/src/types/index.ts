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

// --- Управление сервером (Discord-подобные настройки) ---

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

export interface Channel {
  id: number;
  name: string;
  type: 'text' | 'voice';
  serverId: number;
  position?: number;
  max_users?: number; // Для голосовых каналов
}

export interface Attachment {
  id: number;
  file_url: string;
  message_id: number;
}

export interface Reaction {
  id: number;
  emoji: string;
  count: number;
  users: User[];
  currentUserReacted: boolean;
}

export interface Message {
  id: number;
  content: string | null;
  author: User;
  timestamp: string;
  channelId?: number; // Для сообщений в каналах
  is_edited?: boolean;
  is_deleted?: boolean;
  attachments: Attachment[];
  reactions?: Reaction[];
  reply_to?: Message; // Ответ на сообщение
  sender_id?: number; // Для личных сообщений
  recipient_id?: number; // Для личных сообщений
}

export interface DirectMessage {
  id: number | string; // Может быть временным ID (строка) для pending сообщений
  content: string;
  timestamp: string;
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
    max_users?: number;
  }>;
}

export interface TextChannel {
  id: number;
  name: string;
  channel_id: number;
  position: number;
  created_at?: string;
}

export interface VoiceChannel {
  id: number;
  name: string;
  channel_id: number;
  position: number;
  max_users: number;
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
