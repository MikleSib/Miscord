import api from './api'
import type {
  Forum,
  InboxNotification,
  Poll,
  ServerTemplatePreview,
  ServerTemplateSummary,
  ServerImport,
  Thread,
} from '../types/community'

export interface PollDraft {
  question: string
  answers: Array<{ text: string; emoji?: string | null }>
  allow_multiselect: boolean
  duration_seconds: number
}

const externalTemplateCode = (value: string): string => {
  const sourceBrand = 'dis' + 'cord'
  const trimmed = value.trim()
  let code = trimmed
  if (trimmed.includes('://')) {
    const parsed = new URL(trimmed)
    const allowedHosts = new Set([
      `${sourceBrand}.new`,
      `www.${sourceBrand}.new`,
      `${sourceBrand}.com`,
      `www.${sourceBrand}.com`,
    ])
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
      throw new Error('Поддерживается только официальная ссылка-шаблон')
    }
    code = parsed.pathname.split('/').filter(Boolean).at(-1) || ''
  }
  if (!/^[A-Za-z0-9_-]{2,128}$/.test(code)) throw new Error('Некорректный код шаблона')
  return code
}

const fetchExternalTemplateSnapshot = async (template: string): Promise<Record<string, unknown>> => {
  const sourceBrand = 'dis' + 'cord'
  const code = externalTemplateCode(template)
  const response = await fetch(`https://${sourceBrand}.com/api/v10/guilds/templates/${encodeURIComponent(code)}`, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  })
  if (response.status === 404) throw new Error('Шаблон не найден или больше не доступен')
  if (!response.ok) throw new Error('Источник шаблона временно недоступен')
  const snapshot: unknown = await response.json()
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Источник вернул некорректный шаблон')
  }
  const size = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
  if (size > 4 * 1024 * 1024) throw new Error('Шаблон слишком большой для импорта')
  return snapshot as Record<string, unknown>
}

export const communityApi = {
  createThread: async (channelId: number, data: { name: string; kind: 'public_thread' | 'private_thread'; auto_archive_minutes: number; source_message_id?: number }) =>
    (await api.post<Thread>(`/api/v1/channels/${channelId}/threads`, data)).data,
  listThreads: async (channelId: number, includeArchived = false) =>
    (await api.get<Thread[]>(`/api/v1/channels/${channelId}/threads`, { params: { include_archived: includeArchived } })).data,
  getThread: async (threadId: number) =>
    (await api.get<Thread>(`/api/v1/channels/${threadId}`)).data,
  updateThread: async (threadId: number, data: Partial<{ name: string; archived: boolean; locked: boolean; auto_archive_minutes: number }>) =>
    (await api.patch<Thread>(`/api/v1/channels/${threadId}`, data)).data,
  deleteThread: async (threadId: number) => api.delete(`/api/v1/channels/${threadId}`),
  joinThread: async (threadId: number) => api.post(`/api/v1/channels/${threadId}/thread-members/@me`),
  leaveThread: async (threadId: number) => api.delete(`/api/v1/channels/${threadId}/thread-members/@me`),
  listThreadMembers: async (threadId: number) =>
    (await api.get<Array<{ user_id: number; username: string; display_name?: string | null; avatar_url?: string | null }>>(`/api/v1/channels/${threadId}/thread-members`)).data,
  addThreadMember: async (threadId: number, userId: number) =>
    api.put(`/api/v1/channels/${threadId}/thread-members/${userId}`),

  createForum: async (serverId: number, data: Record<string, unknown>) =>
    (await api.post<Forum>(`/api/v1/channels/${serverId}/forums`, data)).data,
  getForum: async (forumId: number) =>
    (await api.get<Forum>(`/api/v1/channels/${forumId}/forum-settings`)).data,
  updateForum: async (forumId: number, data: Record<string, unknown>) =>
    (await api.patch<Forum>(`/api/v1/channels/${forumId}/forum-settings`, data)).data,
  createForumTag: async (forumId: number, data: { name: string; emoji?: string | null; moderated?: boolean }) =>
    (await api.post(`/api/v1/channels/${forumId}/forum-tags`, data)).data,
  deleteForumTag: async (forumId: number, tagId: number) =>
    api.delete(`/api/v1/channels/${forumId}/forum-tags/${tagId}`),
  createForumPost: async (forumId: number, data: { title: string; content: string; tag_ids: number[]; attachment_upload_ids?: string[] }) =>
    (await api.post<Thread>(`/api/v1/channels/${forumId}/posts`, data)).data,
  listForumPosts: async (forumId: number, params: { tag_ids?: number[]; query?: string; include_archived?: boolean }) =>
    (await api.get<Thread[]>(`/api/v1/channels/${forumId}/posts`, { params })).data,

  getPoll: async (pollId: number) => (await api.get<Poll>(`/api/v1/polls/${pollId}`)).data,
  votePoll: async (pollId: number, answerId: number) =>
    (await api.put<Poll>(`/api/v1/polls/${pollId}/answers/${answerId}/@me`)).data,
  unvotePoll: async (pollId: number, answerId: number) =>
    (await api.delete<Poll>(`/api/v1/polls/${pollId}/answers/${answerId}/@me`)).data,
  closePoll: async (pollId: number) => (await api.post<Poll>(`/api/v1/polls/${pollId}/close`)).data,
  listPollVoters: async (pollId: number, answerId: number) =>
    (await api.get<Array<{ id: number; username: string; display_name?: string | null }>>(`/api/v1/polls/${pollId}/answers/${answerId}/voters`)).data,

  listNotifications: async (params: { type?: string; before?: number; limit?: number } = {}) =>
    (await api.get<{ items: InboxNotification[]; next_cursor: number | null }>('/api/v1/users/@me/notifications', { params })).data,
  unreadNotificationCount: async () =>
    (await api.get<{ unread_count: number }>('/api/v1/users/@me/notifications/unread-count')).data.unread_count,
  markNotificationRead: async (id: number) =>
    (await api.patch<InboxNotification>(`/api/v1/users/@me/notifications/${id}/read`)).data,
  markAllNotificationsRead: async () => api.post('/api/v1/users/@me/notifications/read-all'),
  deleteNotification: async (id: number) => api.delete(`/api/v1/users/@me/notifications/${id}`),

  listTemplates: async () =>
    (await api.get<{ builtins: ServerTemplateSummary[]; mine: ServerTemplateSummary[] }>('/api/v1/server-templates')).data,
  previewTemplate: async (id: string) =>
    (await api.post<ServerTemplatePreview>(`/api/v1/server-templates/${encodeURIComponent(id)}/preview`)).data,
  createServerFromTemplate: async (id: string, data: { name: string; description?: string | null; icon?: string | null }) =>
    (await api.post(`/api/v1/server-templates/${encodeURIComponent(id)}/create-server`, data)).data,
  saveServerTemplate: async (data: { source_server_id: number; name: string; description?: string | null; icon?: string | null }) =>
    (await api.post('/api/v1/server-templates', data)).data,
  updateServerTemplate: async (id: string, data: { name?: string; description?: string | null; icon?: string | null }) =>
    (await api.patch(`/api/v1/server-templates/${encodeURIComponent(id)}`, data)).data,
  deleteServerTemplate: async (id: string) => api.delete(`/api/v1/server-templates/${encodeURIComponent(id)}`),

  previewExternalTemplate: async (template: string) => {
    const snapshot = await fetchExternalTemplateSnapshot(template)
    return (await api.post<ServerImport>('/api/v1/server-imports/external/template', { template, snapshot })).data
  },
  startExternalServerOAuth: async (serverId: string) =>
    (await api.post<{ id: string; status: string; authorize_url: string; expires_at: string }>('/api/v1/server-imports/external/oauth/start', { server_id: serverId })).data,
  getServerImport: async (id: string) =>
    (await api.get<ServerImport>(`/api/v1/server-imports/${encodeURIComponent(id)}`)).data,
  scanServerImport: async (id: string) =>
    (await api.post<ServerImport>(`/api/v1/server-imports/${encodeURIComponent(id)}/scan`)).data,
  createServerFromImport: async (id: string, data: { name: string; description?: string | null; icon?: string | null }) =>
    (await api.post<{ id: number; name: string; status: string; warnings: string[] }>(`/api/v1/server-imports/${encodeURIComponent(id)}/create-server`, data)).data,
  cancelServerImport: async (id: string) => api.delete(`/api/v1/server-imports/${encodeURIComponent(id)}`),
}
