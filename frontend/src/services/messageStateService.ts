import api from './api'
import type { Message } from '../types'

export interface MessageDraftState {
  channel_id: number
  content: string
  attachment_refs: string[]
  updated_at?: string
}

export interface SavedMessageState {
  id: number
  note?: string | null
  created_at: string
  server_id: number
  message: Message & { text_channel_id: number }
}

export interface UnreadChannelState {
  message_id: number
  text_channel_id: number
  server_id: number
  channel_name?: string | null
}

export const messageStateService = {
  listDrafts: async () => (await api.get<MessageDraftState[]>('/api/v1/users/@me/drafts')).data,
  saveDraft: async (channelId: number, content: string) => (
    await api.put(`/api/v1/users/@me/drafts/${channelId}`, { content, attachment_refs: [] })
  ).data,
  deleteDraft: async (channelId: number) => api.delete(`/api/v1/users/@me/drafts/${channelId}`),
  markRead: async (channelId: number, messageId: number | null) => (
    await api.put(`/api/v1/users/@me/read-states/${channelId}`, { message_id: messageId })
  ).data,
  listUnreads: async () => (await api.get<UnreadChannelState[]>('/api/v1/users/@me/unreads')).data,
  listSaved: async () => (await api.get<SavedMessageState[]>('/api/v1/users/@me/saved-messages')).data,
  saveMessage: async (messageId: number, note?: string) => (
    await api.put(`/api/v1/users/@me/saved-messages/${messageId}`, { note: note || null })
  ).data,
  unsaveMessage: async (messageId: number) => api.delete(`/api/v1/users/@me/saved-messages/${messageId}`),
}
