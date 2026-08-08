import api from './api';
import type { BotApplication, BotApplicationCreated, BotTokenReset } from '../types/bot';

export interface BotApplicationPayload {
  name: string;
  description?: string | null;
  avatar_url?: string | null;
}

const botService = {
  async list(): Promise<BotApplication[]> {
    const response = await api.get<BotApplication[]>('/api/bot-apps');
    return response.data;
  },

  async create(payload: BotApplicationPayload): Promise<BotApplicationCreated> {
    const response = await api.post<BotApplicationCreated>('/api/bot-apps', payload);
    return response.data;
  },

  async update(applicationId: number, payload: BotApplicationPayload): Promise<BotApplication> {
    const response = await api.patch<BotApplication>(`/api/bot-apps/${applicationId}`, payload);
    return response.data;
  },

  async resetToken(applicationId: number): Promise<BotTokenReset> {
    const response = await api.post<BotTokenReset>(`/api/bot-apps/${applicationId}/reset-token`);
    return response.data;
  },

  async disable(applicationId: number): Promise<void> {
    await api.delete(`/api/bot-apps/${applicationId}`);
  },
};

export default botService;
