import api from './api';
import { BackendChannel, Channel, ChannelPermissionCatalogItem, ChannelPermissionOverwrite, TextChannel, VoiceChannel, User, FullServerData } from '../types';

export interface CreateChannelRequest {
  name: string;
  description?: string;
}

export interface CreateServerRequest {
  name: string;
  description?: string;
}

export interface CreateTextChannelRequest {
  name: string;
  position: number;
  category_id?: number | null;
}

export interface CreateVoiceChannelRequest {
  name: string;
  position: number;
  category_id?: number | null;
  max_users?: number;
  bitrate?: number;
  video_quality?: 'auto' | '720p';
  kind?: 'voice' | 'stage';
}

export interface UpdateServerRequest {
  name?: string;
  description?: string | null;
  icon?: string | null;
  banner?: string | null;
  is_public?: boolean;
}

export interface UpdateChannelRequest {
  name?: string;
  type?: 'text' | 'voice';
  position?: number;
}

class ChannelService {
  async getUserChannels(): Promise<Channel[]> {
    const response = await api.get<Channel[]>('/api/v1/channels/');
    return response.data;
  }

  async getChannel(channelId: number): Promise<Channel> {
    const response = await api.get<Channel>(`/api/v1/channels/${channelId}`);
    return response.data;
  }

  async joinChannel(channelId: number): Promise<void> {
    await api.post(`/api/v1/channels/${channelId}/join`);
  }

  async createChannel(data: CreateChannelRequest): Promise<BackendChannel> {
    const response = await api.post<BackendChannel>('/api/v1/channels/', data);
    return response.data;
  }

  async createServer(data: CreateServerRequest): Promise<BackendChannel> {
    const response = await api.post<BackendChannel>('/api/v1/channels/', data);
    return response.data;
  }

  async getChannels(): Promise<BackendChannel[]> {
    const response = await api.get<BackendChannel[]>('/api/v1/channels/');
    return response.data;
  }

  async getChannelDetails(channelId: number): Promise<BackendChannel> {
    const response = await api.get<BackendChannel>(`/api/v1/channels/${channelId}`);
    return response.data;
  }

  async createTextChannel(serverId: number, data: CreateTextChannelRequest): Promise<TextChannel> {
    const response = await api.post<TextChannel>(`/api/v1/channels/${serverId}/text-channels`, {
      ...data,
      channel_id: serverId
    });
    return response.data;
  }

  async createVoiceChannel(serverId: number, data: CreateVoiceChannelRequest): Promise<VoiceChannel> {
    const response = await api.post<VoiceChannel>(`/api/v1/channels/${serverId}/voice-channels`, {
      ...data,
      channel_id: serverId
    });
    return response.data;
  }

  async inviteUserToServer(serverId: number, username: string): Promise<any> {
    const response = await api.post(`/api/v1/channels/${serverId}/invite`, null, {
      params: { username }
    });
    return response.data;
  }

  async getServerMembers(serverId: number): Promise<User[]> {
    const response = await api.get<User[]>(`/api/v1/channels/${serverId}/members`);
    return response.data;
  }

  async getVoiceChannelMembers(voiceChannelId: number): Promise<User[]> {
    const response = await api.get<User[]>(`/api/v1/channels/voice/${voiceChannelId}/members`);
    return response.data;
  }

  async moderateVoiceMember(
    voiceChannelId: number,
    userId: number,
    data: { server_muted?: boolean; server_deafened?: boolean },
  ): Promise<User> {
    const response = await api.patch<User>(
      `/api/v1/channels/voice/${voiceChannelId}/members/${userId}`,
      data,
    );
    return response.data;
  }

  async getMyVoiceChannelPermissions(voiceChannelId: number): Promise<number> {
    const response = await api.get<{ permissions: number }>(
      `/api/v1/channels/voice/${voiceChannelId}/permissions/@me`,
    );
    return response.data.permissions;
  }

  async getMyTextChannelPermissions(textChannelId: number): Promise<number> {
    const response = await api.get<{ permissions: number }>(
      `/api/v1/channels/text/${textChannelId}/permissions/@me`,
    );
    return response.data.permissions;
  }

  async moveVoiceMember(voiceChannelId: number, userId: number, targetChannelId: number): Promise<void> {
    await api.post(`/api/v1/channels/voice/${voiceChannelId}/members/${userId}/move`, {
      target_channel_id: targetChannelId,
    });
  }

  async disconnectVoiceMember(voiceChannelId: number, userId: number): Promise<void> {
    await api.delete(`/api/v1/channels/voice/${voiceChannelId}/members/${userId}`);
  }

  async getFullServerData(): Promise<FullServerData> {
    const response = await api.get<FullServerData>('/api/v1/channels/full');
    return response.data;
  }

  async updateServer(serverId: number, data: UpdateServerRequest): Promise<BackendChannel> {
    const response = await api.put<BackendChannel>(`/api/v1/channels/${serverId}`, data);
    return response.data;
  }

  async leaveServer(serverId: number): Promise<void> {
    await api.post(`/api/v1/channels/${serverId}/leave`);
  }

  async deleteServer(serverId: number): Promise<void> {
    await api.delete(`/api/v1/channels/${serverId}`);
  }

  async updateTextChannel(
    textChannelId: number,
    data: { name?: string; position?: number; slow_mode_seconds?: number }
  ): Promise<any> {
    const response = await api.put(`/api/v1/channels/text/${textChannelId}`, data);
    return response.data;
  }

  async updateVoiceChannel(
    voiceChannelId: number,
    data: {
      name?: string
      position?: number
      max_users?: number
      bitrate?: number
      video_quality?: 'auto' | '720p'
      kind?: 'voice' | 'stage'
    }
  ): Promise<any> {
    const response = await api.put(`/api/v1/channels/voice/${voiceChannelId}`, data);
    return response.data;
  }

  async deleteTextChannel(textChannelId: number): Promise<void> {
    await api.delete(`/api/v1/channels/text/${textChannelId}`);
  }

  async deleteVoiceChannel(voiceChannelId: number): Promise<void> {
    await api.delete(`/api/v1/channels/voice/${voiceChannelId}`);
  }

  async getChannelPermissionCatalog(channelKind: 'text' | 'voice'): Promise<ChannelPermissionCatalogItem[]> {
    const response = await api.get<{ permissions: ChannelPermissionCatalogItem[] }>(
      `/api/v1/channels/permissions/catalog/${channelKind}`
    );
    return response.data.permissions;
  }

  async getChannelPermissionOverwrites(channelKind: 'text' | 'voice', channelId: number): Promise<ChannelPermissionOverwrite[]> {
    const response = await api.get<{ overwrites: ChannelPermissionOverwrite[] }>(
      `/api/v1/channels/${channelKind}/${channelId}/permission-overwrites`
    );
    return response.data.overwrites;
  }

  async upsertChannelPermissionOverwrite(
    channelKind: 'text' | 'voice',
    channelId: number,
    payload: {
      target_type: 'role' | 'member';
      target_id: number;
      allow: number;
      deny: number;
    }
  ): Promise<ChannelPermissionOverwrite> {
    const response = await api.put<ChannelPermissionOverwrite>(
      `/api/v1/channels/${channelKind}/${channelId}/permission-overwrites`,
      payload
    );
    return response.data;
  }

  async deleteChannelPermissionOverwrite(
    channelKind: 'text' | 'voice',
    channelId: number,
    targetType: 'role' | 'member',
    targetId: number
  ): Promise<void> {
    await api.delete(
      `/api/v1/channels/${channelKind}/${channelId}/permission-overwrites/${targetType}/${targetId}`
    );
  }
}

export default new ChannelService();
