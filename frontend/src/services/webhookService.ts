import api from './api'
import { IncomingWebhook, WebhookCreateResult } from '../types/webhook'

export interface WebhookDraft {
  name?: string
  avatar_url?: string | null
  channel_id?: number
}

const webhookService = {
  async list(channelId: number): Promise<IncomingWebhook[]> {
    const response = await api.get(`/api/channels/text/${channelId}/webhooks`)
    return response.data
  },

  async create(channelId: number, payload: { name: string; avatar_url?: string | null }): Promise<WebhookCreateResult> {
    const response = await api.post(`/api/channels/text/${channelId}/webhooks`, payload)
    return response.data
  },

  async update(webhookId: number, payload: WebhookDraft): Promise<IncomingWebhook> {
    const response = await api.patch(`/api/webhooks/${webhookId}`, payload)
    return response.data
  },

  async remove(webhookId: number): Promise<void> {
    await api.delete(`/api/webhooks/${webhookId}`)
  },

  async executionUrl(webhookId: number): Promise<string> {
    const response = await api.get(`/api/webhooks/${webhookId}/execution-url`)
    return response.data.execution_url
  },

  async resetToken(webhookId: number): Promise<string> {
    const response = await api.post(`/api/webhooks/${webhookId}/reset-token`)
    return response.data.execution_url
  },

  async test(webhookId: number): Promise<void> {
    await api.post(`/api/webhooks/${webhookId}/test`)
  },
}

export default webhookService

