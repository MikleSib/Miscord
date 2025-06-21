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

  async createChannel(channelData: {
    name: string;
    description?: string;
  }): Promise<Channel> {
    const response = await api.post<Channel>('/api/channels/', channelData);
    return response.data;
  }

  async createTextChannel(channelId: number, data: {
    name: string;
    position: number;
  }): Promise<TextChannel> {
    const requestData = {
      ...data,
      channel_id: channelId
    };
    const response = await api.post<TextChannel>(`/api/channels/${channelId}/text-channels`, requestData);
    return response.data;
  }

  async createVoiceChannel(channelId: number, data: {
    name: string;
    position: number;
    max_users: number;
  }): Promise<VoiceChannel> {
    const requestData = {
      ...data,
      channel_id: channelId
    };
    const response = await api.post<VoiceChannel>(`/api/channels/${channelId}/voice-channels`, requestData);
    return response.data;
  }
}

export default new ChannelService();