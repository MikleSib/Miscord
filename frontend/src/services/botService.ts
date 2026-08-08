import api from './api';
import type {
  BotApplication,
  BotApplicationCreated,
  BotClientSecretReset,
  BotAuthorizationPreview,
  BotTokenReset,
  InstalledBot,
  BotCommand,
  BotCommandPayload,
  BotCommandReplacePayload,
  BotCommandUpdatePayload,
  BotCommandSyncResult,
  BotCommandDispatchPayload,
  BotCommandDispatchResponse,
  ChannelApplicationCommands,
  ClientInteractionResult,
} from '../types/bot';
import { Permissions } from '../lib/permissions';

export interface BotApplicationPayload {
  name: string;
  description?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  bot_public?: boolean;
  bot_require_code_grant?: boolean;
  terms_of_service_url?: string | null;
  privacy_policy_url?: string | null;
  redirect_uris?: string[];
  interactions_endpoint_url?: string | null;
  event_webhooks_url?: string | null;
  event_webhooks_types?: string[];
  tags?: string[];
  install_params?: Record<string, unknown> | null;
  integration_types_config?: Record<string, unknown>;
  custom_install_url?: string | null;
  flags?: number;
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

  async uploadMedia(applicationId: number, kind: 'avatar' | 'banner', file: File): Promise<BotApplication> {
    const form = new FormData();
    form.append('image', file);
    const response = await api.post<BotApplication>(`/api/bot-apps/${applicationId}/${kind}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deleteMedia(applicationId: number, kind: 'avatar' | 'banner'): Promise<BotApplication> {
    const response = await api.delete<BotApplication>(`/api/bot-apps/${applicationId}/${kind}`);
    return response.data;
  },

  async resetToken(applicationId: number): Promise<BotTokenReset> {
    const response = await api.post<BotTokenReset>(`/api/bot-apps/${applicationId}/reset-token`);
    return response.data;
  },

  async resetClientSecret(applicationId: number): Promise<BotClientSecretReset> {
    const response = await api.post<BotClientSecretReset>(`/api/bot-apps/${applicationId}/reset-client-secret`);
    return response.data;
  },

  async disable(applicationId: number): Promise<void> {
    await api.delete(`/api/bot-apps/${applicationId}`);
  },

  async getInviteLink(
    applicationId: number,
    permissions: number | string = Permissions.VIEW_CHANNELS + Permissions.SEND_MESSAGES,
  ): Promise<string> {
    const response = await api.get<{ invite_url: string }>(`/api/bot-apps/${applicationId}/invite-link`, {
      params: { permissions, scope: 'bot applications.commands' },
    });
    return response.data.invite_url;
  },

  async listChannelCommands(channelId: number): Promise<ChannelApplicationCommands> {
    const response = await api.get<ChannelApplicationCommands>(`/api/channels/${channelId}/application-commands`);
    return response.data;
  },

  async invokeCommand(
    channelId: number,
    applicationId: string,
    commandId: string,
    data: Record<string, unknown>,
  ): Promise<ClientInteractionResult> {
    const response = await api.post<ClientInteractionResult>(`/api/channels/${channelId}/interactions`, {
      application_id: applicationId,
      command_id: commandId,
      data,
    });
    return response.data;
  },

  async interactComponent(
    channelId: number,
    payload: { message_id: number; custom_id: string; component_type: number; values?: string[] },
  ): Promise<ClientInteractionResult> {
    const response = await api.post<ClientInteractionResult>(`/api/channels/${channelId}/component-interactions`, payload);
    return response.data;
  },

  async submitModal(
    channelId: number,
    payload: { source_interaction_id: string; custom_id: string; components: Array<Record<string, unknown>> },
  ): Promise<ClientInteractionResult> {
    const response = await api.post<ClientInteractionResult>(`/api/channels/${channelId}/modal-interactions`, payload);
    return response.data;
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

  async getCommand(applicationId: number, commandId: number): Promise<BotCommand> {
    const response = await api.get<BotCommand>(`/api/bot-apps/${applicationId}/commands/${commandId}`);
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

  async replaceCommand(
    applicationId: number,
    commandId: number,
    payload: BotCommandReplacePayload,
  ): Promise<BotCommand> {
    const response = await api.put<BotCommand>(`/api/bot-apps/${applicationId}/commands/${commandId}`, payload);
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
