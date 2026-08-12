import { describe, expect, it, vi } from 'vitest'
import type { Message } from '../../types'
import { applyOutgoingMessageAck } from '../outgoingMessageAck'

const message = {
  id: 42,
  content: 'hello',
  channelId: 7,
  timestamp: '2026-08-12T10:00:00Z',
  author: { id: 1, username: 'misha', email: '' },
  attachments: [],
} as Message

describe('applyOutgoingMessageAck', () => {
  it('adds the saved message before removing its optimistic card', () => {
    const calls: string[] = []
    const addMessage = vi.fn(() => calls.push('message'))
    const acknowledge = vi.fn(() => calls.push('ack'))

    applyOutgoingMessageAck(
      { type: 'message_ack', data: { client_nonce: 'client-123', message } },
      addMessage,
      acknowledge,
    )

    expect(addMessage).toHaveBeenCalledWith(message)
    expect(acknowledge).toHaveBeenCalledWith('client-123')
    expect(calls).toEqual(['message', 'ack'])
  })

  it('still acknowledges legacy payloads without a message', () => {
    const acknowledge = vi.fn()

    applyOutgoingMessageAck({ client_nonce: 'legacy' }, vi.fn(), acknowledge)

    expect(acknowledge).toHaveBeenCalledWith('legacy')
  })
})
