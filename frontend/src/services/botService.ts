import api from './api';
import type {
  BotApplication,
  BotApplicationCreated,
  BotAuthorizationPreview,
  BotTokenReset,
  InstalledBot,
  BotCommand,
  BotCommandPayload,
  BotCommandUpdatePayload,
  BotCommandSyncResult,
  BotCommandDispatchPayload,
  BotCommandDispatchResponse,
} from '../types/bot';

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

  async listCommands(applicationId: number, options?: { serverId?: number | null; includeDisabled?: boolean }): Promise<BotCommand[]> {
    const params: Record<string, string | number | boolean> = {
      include_disabled: options?.includeDisabled ?? false,
    };
    if (options?.serverId !== undefined && options?.serverId !== null) {
      params.server_id = options.serverId;
    }
    const response = await api.get<BotCommand[]>(`/api/bot-apps/${applicationId}/commands`, {
      params,
    });
    return response.data;
  },

  async createCommand(applicationId: number, payload: BotCommandPayload): Promise<BotCommand[]> {
    const response = await api.post<BotCommand[]>(`/api/bot-apps/${applicationId}/commands`, payload);
    return response.data;
  },

  async updateCommand(
    applicationId: number,
    commandId: number,
    payload: BotCommandUpdatePayload,
  ): Promise<BotCommand> {
    const response = await api.patch<BotCommand>(`/api/bot-apps/${applicationId}/commands/${commandId}`, payload);
    return response.data;
  },

  async deleteCommand(applicationId: number, commandId: number): Promise<void> {
    await api.delete(`/api/bot-apps/${applicationId}/commands/${commandId}`);
  },

  async syncCommands(applicationId: number, options?: { serverId?: number | null }): Promise<BotCommandSyncResult> {
    const params: Record<string, string | number> = {};
    if (options?.serverId !== undefined && options?.serverId !== null) {
      params.server_id = options.serverId;
    }
    const response = await api.post<BotCommandSyncResult>(`/api/bot-apps/${applicationId}/commands/sync`, null, {
      params,
    });
    return response.data;
  },

  async dispatchCommand(
    applicationId: number,
    botToken: string,
    payload: BotCommandDispatchPayload,
  ): Promise<BotCommandDispatchResponse> {
    const response = await api.post<BotCommandDispatchResponse>(
      `/api/bot/apps/${applicationId}/commands/dispatch`,
      payload,
      {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      },
    );
    return response.data;
  },
};

export default botService;
