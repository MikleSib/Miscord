import type { PollDraft } from '../../services/communityApi'
import unifiedWebSocketService from '../../services/unifiedWebSocketService'
import type { Message } from '../../types'

interface PollSocket {
  on: (event: string, handler: (payload: unknown) => void) => void
  off: (event: string, handler: (payload: unknown) => void) => void
  send: (payload: unknown) => boolean
}

interface PublishPollOptions {
  channelId: number
  poll: PollDraft
  nonce?: string
  timeoutMs?: number
  socket?: PollSocket
}

function eventData<T>(payload: unknown): T | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const envelope = payload as { data?: T }
  return envelope.data ?? payload as T
}

export function publishPollMessage({
  channelId,
  poll,
  nonce = crypto.randomUUID(),
  timeoutMs = 15_000,
  socket = unifiedWebSocketService,
}: PublishPollOptions): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Сервер не подтвердил публикацию опроса.'))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('message_ack', onAck)
      socket.off('message_send_failed', onFailure)
    }
    const onAck = (payload: unknown) => {
      const data = eventData<{ client_nonce?: string | null; message?: Message }>(payload)
      if (data?.client_nonce !== nonce || !data.message) return
      cleanup()
      resolve(data.message)
    }
    const onFailure = (payload: unknown) => {
      const data = eventData<{ client_nonce?: string | null; message?: string }>(payload)
      if (data?.client_nonce !== nonce) return
      cleanup()
      reject(new Error(data.message || 'Не удалось опубликовать опрос.'))
    }

    socket.on('message_ack', onAck)
    socket.on('message_send_failed', onFailure)
    const sent = socket.send({
      type: 'chat_message',
      text_channel_id: channelId,
      content: '',
      poll,
      client_nonce: nonce,
    })
    if (!sent) {
      cleanup()
      reject(new Error('Нет соединения с сервером. Повторите попытку.'))
    }
  })
}
