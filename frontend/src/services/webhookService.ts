import api from './api'
import type {
  IncomingWebhook,
  WebhookExecutionUrl,
  WebhookUpdatePayload,
} from '../types/webhook'

class WebhookService {
  async list(channelId: number): Promise<IncomingWebhook[]> {
    const response = await api.get<IncomingWebhook[]>(
      '/api/channels/text/' + channelId + '/webhooks',
    )
    return response.data
  }

  async create(channelId: number, name = 'Captain Hook'): Promise<IncomingWebhook> {
    const response = await api.post<IncomingWebhook>(
      '/api/channels/text/' + channelId + '/webhooks',
      { name },
    )
    return response.data
  }

  async update(
    webhookId: number,
    payload: WebhookUpdatePayload,
  ): Promise<IncomingWebhook> {
    const response = await api.patch<IncomingWebhook>(
      '/api/webhooks/' + webhookId,
      payload,
    )
    return response.data
  }

  async uploadAvatar(webhookId: number, avatar: File): Promise<IncomingWebhook> {
    const form = new FormData()
    form.append('avatar', avatar)
    const response = await api.post<IncomingWebhook>(
      '/api/webhooks/' + webhookId + '/avatar',
      form,
    )
    return response.data
  }

  async remove(webhookId: number): Promise<void> {
    await api.delete('/api/webhooks/' + webhookId)
  }

  async resetToken(webhookId: number): Promise<WebhookExecutionUrl> {
    const response = await api.post<WebhookExecutionUrl>(
      '/api/webhooks/' + webhookId + '/reset-token',
    )
    return response.data
  }

  async test(webhookId: number): Promise<void> {
    await api.post('/api/webhooks/' + webhookId + '/test')
  }
}

export const webhookService = new WebhookService()
