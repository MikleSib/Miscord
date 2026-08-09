import api from './api'
import type { Message } from '../types'

export interface PinnedMessagesResponse {
  text_channel_id: number
  limit: number
  can_manage: boolean
  messages: Message[]
}

class PinService {
  async list(textChannelId: number): Promise<PinnedMessagesResponse> {
    const response = await api.get(`/api/v1/channels/text/${textChannelId}/pins`)
    return response.data
  }

  async pin(textChannelId: number, messageId: number): Promise<void> {
    await api.put(`/api/v1/channels/text/${textChannelId}/pins/${messageId}`)
  }

  async unpin(textChannelId: number, messageId: number): Promise<void> {
    await api.delete(`/api/v1/channels/text/${textChannelId}/pins/${messageId}`)
  }
}

export const pinService = new PinService()
export default pinService
