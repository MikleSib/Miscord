import type { Message } from '../types'
import { channelApi } from './api'
import unifiedWebSocketService from './unifiedWebSocketService'

export type ChatMessageHandler = (message: Message) => void
export type SlowModeHandler = (data: { text_channel_id: number; retry_after_seconds: number }) => void
export type RateLimitHandler = (data: {
  message?: string
  retry_after_seconds: number
  scope?: string
  text_channel_id?: number
  recipient_id?: number
}) => void

/** Channel-scoped facade backed by the application-wide unified socket. */
class ChatService {
  private channelId: number | null = null
  private bindings = new Map<string, (data: any) => void>()

  connect(channelId: number, token: string) {
    if (this.channelId !== null && this.channelId !== channelId) {
      unifiedWebSocketService.unsubscribeChannel(this.channelId)
    }
    this.channelId = channelId
    unifiedWebSocketService.connect(token)
    unifiedWebSocketService.subscribeChannel(channelId)
  }

  disconnect() {
    if (this.channelId !== null) unifiedWebSocketService.unsubscribeChannel(this.channelId)
    this.channelId = null
  }

  sendMessage(content: string, attachments: string[] = [], replyToId?: number) {
    if (this.channelId !== null) {
      unifiedWebSocketService.sendChatMessage(this.channelId, content, attachments, replyToId)
    }
  }

  sendTyping() {
    if (this.channelId !== null) unifiedWebSocketService.sendTyping(this.channelId)
  }

  private bind(event: string, handler: (data: any) => void) {
    const previous = this.bindings.get(event)
    if (previous) unifiedWebSocketService.off(event, previous)
    const scoped = (payload: any) => {
      const data = payload?.data ?? payload
      const channelId = data?.text_channel_id ?? data?.channelId
      if (channelId === undefined || channelId === this.channelId) handler(data)
    }
    this.bindings.set(event, scoped)
    unifiedWebSocketService.on(event, scoped)
  }

  onMessage(handler: ChatMessageHandler) { this.bind('new_message', handler) }
  onSlowMode(handler: SlowModeHandler) { this.bind('slow_mode', handler) }
  onRateLimit(handler: RateLimitHandler) { this.bind('rate_limit', handler) }
  onTyping(handler: (data: any) => void) { this.bind('typing', handler) }
  onMessageDeleted(handler: (data: { message_id: number; text_channel_id: number }) => void) {
    this.bind('message_deleted', handler)
  }
  onMessageEdited(handler: ChatMessageHandler) { this.bind('message_edited', handler) }
  onReactionUpdated(handler: (data: any) => void) { this.bind('reaction_updated', handler) }

  loadMessageHistory(channelId: number, limit = 50, before?: number) {
    return channelApi.getChannelMessages(channelId, limit, before)
  }
}

export default new ChatService()
