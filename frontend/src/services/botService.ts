import api from './api';
import type { BotApplication, BotApplicationCreated, BotAuthorizationPreview, BotTokenReset, InstalledBot } from '../types/bot';

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

  async getInviteLink(applicationId: number, permissions = 3): Promise<string> {
    const response = await api.get<{ invite_url: string }>(`/api/bot-apps/${applicationId}/invite-link`, {
      params: { permissions, scope: 'bot applications.commands' },
    });
    return response.data.invite_url;
  },

  async getAuthorization(clientId: string, scope: string, permissions: number): Promise<BotAuthorizationPreview> {
    const response = await api.get<BotAuthorizationPreview>('/api/bot/oauth/authorize', {
      params: { client_id: clientId, scope, permissions },
    });
    return response.data;
  },

  async authorize(clientId: string, serverId: number, scope: string, permissions: number): Promise<void> {
    await api.post('/api/bot/oauth/authorize', {
      client_id: clientId,
      server_id: serverId,
      scope,
      permissions,
    });
  },

  async listInstalled(serverId: number): Promise<InstalledBot[]> {
    const response = await api.get<{ bots: InstalledBot[] }>(`/api/servers/${serverId}/bots`);
    return response.data.bots;
  },

  async uninstall(serverId: number, applicationId: number): Promise<void> {
    await api.delete(`/api/servers/${serverId}/bots/${applicationId}`);
  },
};

export default botService;
