export interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_online: boolean;
  created_at: string;
  updated_at?: string;
}

export interface Channel {
  id: number;
  name: string;
  description?: string;
  owner_id: number;
  owner: User;
  created_at: string;
  updated_at?: string;
  text_channels: TextChannel[];
  voice_channels: VoiceChannel[];
  members_count: number;
}

export interface TextChannel {
  id: number;
  name: string;
  channel_id: number;
  position: number;
  created_at: string;
}

export interface VoiceChannel {
  id: number;
  name: string;
  channel_id: number;
  position: number;
  max_users: number;
  created_at: string;
  active_users_count: number;
}

export interface Message {
  id: number;
  content: string;
  author_id: number;
  author: User;
  text_channel_id: number;
  created_at: string;
  updated_at?: string;
  is_edited: boolean;
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