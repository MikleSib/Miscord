import api from './api'

export type DmPrivacy = 'everyone' | 'friends' | 'friends_and_servers' | 'nobody'
export type FriendRequestPrivacy = 'everyone' | 'server_members' | 'nobody'

export interface PrivacySettings {
  direct_messages: DmPrivacy
  friend_requests: FriendRequestPrivacy
}

export interface BlockedUser {
  id: number
  username: string
  display_name?: string | null
  avatar_url?: string | null
  blocked_at: string
}

export interface SafetyReportState {
  id: number
  category: 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'impersonation' | 'other'
  details?: string | null
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed'
  resolution?: string | null
  channel_id?: number | null
  message_id?: number | null
  created_at: string
  resolved_at?: string | null
  reporter?: Pick<BlockedUser, 'id' | 'username' | 'display_name' | 'avatar_url'> | null
  target?: Pick<BlockedUser, 'id' | 'username' | 'display_name' | 'avatar_url'> | null
}

export const safetyService = {
  privacy: async () => (await api.get<PrivacySettings>('/api/v1/users/@me/privacy')).data,
  updatePrivacy: async (value: PrivacySettings) => (
    await api.put<PrivacySettings>('/api/v1/users/@me/privacy', value)
  ).data,
  blocks: async () => (await api.get<BlockedUser[]>('/api/v1/users/@me/blocks')).data,
  block: async (userId: number) => api.put(`/api/v1/users/@me/blocks/${userId}`),
  unblock: async (userId: number) => api.delete(`/api/v1/users/@me/blocks/${userId}`),
  report: async (payload: {
    target_user_id?: number
    server_id?: number
    channel_id?: number
    message_id?: number
    dm_message_id?: number
    category: 'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'impersonation' | 'other'
    details?: string
  }) => (await api.post('/api/v1/reports', payload)).data,
  serverReports: async (serverId: number, status = 'open') => (
    await api.get<SafetyReportState[]>(`/api/v1/servers/${serverId}/reports`, { params: { status } })
  ).data,
  resolveReport: async (serverId: number, reportId: number, status: SafetyReportState['status'], resolution?: string) => (
    await api.patch<SafetyReportState>(`/api/v1/servers/${serverId}/reports/${reportId}`, { status, resolution: resolution || null })
  ).data,
  timeoutMember: async (serverId: number, userId: number, durationSeconds: number, reason?: string) => (
    await api.put(`/api/v1/servers/${serverId}/members/${userId}/timeout`, {
      duration_seconds: durationSeconds, reason: reason || null,
    })
  ).data,
  removeTimeout: async (serverId: number, userId: number) => api.delete(`/api/v1/servers/${serverId}/members/${userId}/timeout`),
}
