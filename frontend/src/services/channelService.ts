import api from './api';
import { BackendChannel, Channel, TextChannel, VoiceChannel, User } from '../types';

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
}

export interface CreateVoiceChannelRequest {
  name: string;
  position: number;
  max_users: number;
}

class ChannelService {
  async getUserChannels(): Promise<Channel[]> {
    const response = await api.get<Channel[]>('/api/channels/');
    return response.data;
  }

  async getChannel(channelId: number): Promise<Channel> {
    const response = await api.get<Channel>(`/api/channels/${channelId}`);
    return response.data;
  }

  async joinChannel(channelId: number): Promise<void> {
    await api.post(`/api/channels/${channelId}/join`);
  }

  async createChannel(data: CreateChannelRequest): Promise<BackendChannel> {
    const response = await api.post<BackendChannel>('/api/channels/', data);
    return response.data;
  }

  async createServer(data: CreateServerRequest): Promise<BackendChannel> {
    const response = await api.post<BackendChannel>('/api/channels/', data);
    return response.data;
  }

  async getChannels(): Promise<BackendChannel[]> {
    const response = await api.get<BackendChannel[]>('/api/channels/');
    return response.data;
  }

  async getChannelDetails(channelId: number): Promise<BackendChannel> {
    const response = await api.get<BackendChannel>(`/api/channels/${channelId}`);
    return response.data;
  }

  async createTextChannel(serverId: number, data: CreateTextChannelRequest): Promise<TextChannel> {
    const response = await api.post<TextChannel>(`/api/channels/${serverId}/text-channels`, {
      ...data,
      channel_id: serverId
    });
    return response.data;
  }

  async createVoiceChannel(serverId: number, data: CreateVoiceChannelRequest): Promise<VoiceChannel> {
    const response = await api.post<VoiceChannel>(`/api/channels/${serverId}/voice-channels`, {
      ...data,
      channel_id: serverId
    });
    return response.data;
  }

  async inviteUserToServer(serverId: number, username: string): Promise<any> {
    const response = await api.post(`/api/channels/${serverId}/invite`, null, {
      params: { username }
    });
    return response.data;
  }

  async getServerMembers(serverId: number): Promise<User[]> {
    const response = await api.get<User[]>(`/api/channels/${serverId}/members`);
    return response.data;
  }
}

export default new ChannelService();