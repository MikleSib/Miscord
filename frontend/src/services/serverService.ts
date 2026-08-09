import api from './api';
import {
  AuditLogEntry,
  ChannelNotificationLevel,
  InvitePreview,
  PermissionCatalog,
  Role,
  ServerBan,
  ServerInvite,
  ServerMember,
  ServerMembershipInfo,
  ServerNotificationSettings,
} from '../types';

export interface CreateRoleRequest {
  name: string;
  color?: string | null;
  permissions?: number;
}

export interface UpdateRoleRequest {
  name?: string;
  color?: string | null;
  permissions?: number;
}

export interface CreateInviteRequest {
  max_age_seconds?: number | null;
  max_uses?: number | null;
  target_text_channel_id?: number | null;
  unique?: boolean;
}

export interface AuditLogQuery {
  limit?: number;
  before?: number;
  action?: string;
  actor_id?: number;
}

class ServerService {
  // --- Права ---

  async getPermissionCatalog(): Promise<PermissionCatalog> {
    const response = await api.get<PermissionCatalog>('/api/v1/servers/permissions/catalog');
    return response.data;
  }

  async getMyMembership(serverId: number): Promise<ServerMembershipInfo> {
    const response = await api.get<ServerMembershipInfo>(`/api/v1/servers/${serverId}/me`);
    return response.data;
  }

  // --- Уведомления ---

  async getNotificationSettings(serverId: number): Promise<ServerNotificationSettings> {
    const response = await api.get<ServerNotificationSettings>(
      `/api/v1/servers/${serverId}/me/notifications`
    );
    return response.data;
  }

  async updateNotificationSettings(
    serverId: number,
    data: Partial<Omit<ServerNotificationSettings, 'server_id' | 'channel_overrides'>>
  ): Promise<ServerNotificationSettings> {
    const response = await api.patch<ServerNotificationSettings>(
      `/api/v1/servers/${serverId}/me/notifications`,
      data
    );
    return response.data;
  }

  async setChannelNotificationOverride(
    serverId: number,
    textChannelId: number,
    level: ChannelNotificationLevel
  ): Promise<ServerNotificationSettings> {
    const response = await api.put<ServerNotificationSettings>(
      `/api/v1/servers/${serverId}/me/notifications/channels/${textChannelId}`,
      { level }
    );
    return response.data;
  }

  async removeChannelNotificationOverride(
    serverId: number,
    textChannelId: number
  ): Promise<ServerNotificationSettings> {
    const response = await api.delete<ServerNotificationSettings>(
      `/api/v1/servers/${serverId}/me/notifications/channels/${textChannelId}`
    );
    return response.data;
  }

  // --- Участники ---

  async getMembers(serverId: number): Promise<{ members: ServerMember[]; owner_id: number }> {
    const response = await api.get<{ members: ServerMember[]; owner_id: number; server_id: number }>(
      `/api/v1/servers/${serverId}/members`
    );
    return response.data;
  }

  async updateMemberNickname(
    serverId: number,
    userId: number,
    nickname: string | null
  ): Promise<{ nickname: string | null }> {
    const response = await api.patch(`/api/v1/servers/${serverId}/members/${userId}`, { nickname });
    return response.data;
  }

  async kickMember(serverId: number, userId: number, reason?: string): Promise<void> {
    await api.delete(`/api/v1/servers/${serverId}/members/${userId}`, {
      params: reason ? { reason } : undefined,
    });
  }

  async transferOwnership(serverId: number, userId: number): Promise<void> {
    await api.post(`/api/v1/servers/${serverId}/transfer-ownership`, { user_id: userId });
  }

  // --- Баны ---

  async getBans(serverId: number): Promise<ServerBan[]> {
    const response = await api.get<{ bans: ServerBan[] }>(`/api/v1/servers/${serverId}/bans`);
    return response.data.bans;
  }

  async banMember(serverId: number, userId: number, reason?: string): Promise<void> {
    await api.post(`/api/v1/servers/${serverId}/bans`, {
      user_id: userId,
      reason: reason || null,
    });
  }

  async unbanMember(serverId: number, userId: number): Promise<void> {
    await api.delete(`/api/v1/servers/${serverId}/bans/${userId}`);
  }

  // --- Роли ---

  async getRoles(serverId: number): Promise<Role[]> {
    const response = await api.get<{ roles: Role[] }>(`/api/v1/servers/${serverId}/roles`);
    return response.data.roles;
  }

  async createRole(serverId: number, data: CreateRoleRequest): Promise<Role> {
    const response = await api.post<Role>(`/api/v1/servers/${serverId}/roles`, {
      name: data.name,
      color: data.color ?? null,
      permissions: data.permissions ?? 0,
    });
    return response.data;
  }

  async updateRole(serverId: number, roleId: number, data: UpdateRoleRequest): Promise<Role> {
    const response = await api.patch<Role>(`/api/v1/servers/${serverId}/roles/${roleId}`, data);
    return response.data;
  }

  async deleteRole(serverId: number, roleId: number): Promise<void> {
    await api.delete(`/api/v1/servers/${serverId}/roles/${roleId}`);
  }

  async reorderRoles(serverId: number, roleIds: number[]): Promise<void> {
    await api.patch(`/api/v1/servers/${serverId}/roles/reorder`, { role_ids: roleIds });
  }

  async addMemberRole(serverId: number, userId: number, roleId: number): Promise<{ role_ids: number[] }> {
    const response = await api.put(`/api/v1/servers/${serverId}/members/${userId}/roles/${roleId}`);
    return response.data;
  }

  async removeMemberRole(serverId: number, userId: number, roleId: number): Promise<{ role_ids: number[] }> {
    const response = await api.delete(`/api/v1/servers/${serverId}/members/${userId}/roles/${roleId}`);
    return response.data;
  }

  // --- Приглашения ---

  async getInvites(serverId: number): Promise<{ invites: ServerInvite[]; can_manage: boolean }> {
    const response = await api.get<{ invites: ServerInvite[]; can_manage: boolean }>(
      `/api/v1/servers/${serverId}/invites`
    );
    return response.data;
  }

  async createInvite(serverId: number, data: CreateInviteRequest): Promise<ServerInvite> {
    const response = await api.post<ServerInvite>(`/api/v1/servers/${serverId}/invites`, data);
    return response.data;
  }

  async deleteInvite(code: string): Promise<void> {
    await api.delete(`/api/v1/servers/invites/${code}`);
  }

  async getInvitePreview(code: string): Promise<InvitePreview> {
    const response = await api.get<InvitePreview>(`/api/v1/servers/invites/${code}`);
    return response.data;
  }

  async acceptInvite(code: string): Promise<{ server_id: number; already_member: boolean }> {
    const response = await api.post(`/api/v1/servers/invites/${code}/accept`);
    return response.data;
  }

  // --- Журнал аудита ---

  async getAuditLogs(
    serverId: number,
    query: AuditLogQuery = {}
  ): Promise<{ entries: AuditLogEntry[]; has_more: boolean }> {
    const response = await api.get<{ entries: AuditLogEntry[]; has_more: boolean }>(
      `/api/v1/servers/${serverId}/audit-logs`,
      { params: query }
    );
    return response.data;
  }
}

export const serverService = new ServerService();
export default serverService;
