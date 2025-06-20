import api from './api';
import { Channel, TextChannel, VoiceChannel } from '../types';

interface CreateChannelData {
  name: string;
  description?: string;
}

interface CreateTextChannelData {
  name: string;
  position?: number;
}

interface CreateVoiceChannelData {
  name: string;
  position?: number;
  max_users?: number;
}

class ChannelService {
  async getMyChannels(): Promise<Channel[]> {
    const response = await api.get<Channel[]>('/api/channels');
    return response.data;
  }

  async getChannel(channelId: number): Promise<Channel> {
    const response = await api.get<Channel>(`/api/channels/${channelId}`);
    return response.data;
  }

  async createChannel(data: CreateChannelData): Promise<Channel> {
    const response = await api.post<Channel>('/api/channels', data);
    return response.data;
  }

  async joinChannel(channelId: number): Promise<void> {
    await api.post(`/api/channels/${channelId}/join`);
  }

  async createTextChannel(channelId: number, data: CreateTextChannelData): Promise<TextChannel> {
    const response = await api.post<TextChannel>(`/api/channels/${channelId}/text-channels`, data);
    return response.data;
  }

  async createVoiceChannel(channelId: number, data: CreateVoiceChannelData): Promise<VoiceChannel> {
    const response = await api.post<VoiceChannel>(`/api/channels/${channelId}/voice-channels`, data);
    return response.data;
  }
}

export default new ChannelService();