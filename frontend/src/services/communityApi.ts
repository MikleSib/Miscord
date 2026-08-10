import api from './api'
import type {
  Forum,
  InboxNotification,
  Poll,
  ServerTemplatePreview,
  ServerTemplateSummary,
  Thread,
} from '../types/community'

export interface PollDraft {
  question: string
  answers: Array<{ text: string; emoji?: string | null }>
  allow_multiselect: boolean
  duration_seconds: number
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
}
