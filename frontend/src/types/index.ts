export interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  is_active?: boolean;
  is_online?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Server {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  channels: Channel[];
}

export interface Channel {
  id: number;
  name: string;
  type: 'text' | 'voice';
  serverId: number;
  position?: number;
  max_users?: number; // Для голосовых каналов
}

export interface Message {
  id: number;
  content: string;
  author: User;
  timestamp: string;
  channelId: number;
  is_edited?: boolean;
}

// Бэкенд типы (для API)
export interface BackendChannel {
  id: number;
  name: string;
  description?: string;
  owner_id: number;
  owner?: User;
  created_at: string;
  updated_at?: string;
  text_channels?: TextChannel[];
  voice_channels?: VoiceChannel[];
  members_count?: number;
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
  email: string;
  password: string;
}

export interface VoiceUser {
  user_id: number;
  username: string;
  is_muted: boolean;
  is_deafened: boolean;
}