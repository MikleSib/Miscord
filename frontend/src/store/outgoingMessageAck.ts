import type { Message } from '../types'

interface MessageAckData {
  client_nonce?: string | null
  message?: Message
}

export function applyOutgoingMessageAck(
  payload: unknown,
  addMessage: (message: Message) => void,
  acknowledge: (clientNonce?: string | null) => void,
) {
  const envelope = payload as { data?: MessageAckData } | MessageAckData | null
  const data = (envelope && 'data' in envelope ? envelope.data : envelope) as MessageAckData | null | undefined
  if (data?.message) addMessage(data.message)
  acknowledge(data?.client_nonce)
}
