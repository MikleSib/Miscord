import { describe, expect, it, vi } from 'vitest'
import { publishPollMessage } from '../pollRealtime'

function socket() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  return {
    send: vi.fn(() => true),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      const handlers = listeners.get(event) ?? new Set()
      handlers.add(handler)
      listeners.set(event, handlers)
    }),
    off: vi.fn((event: string, handler: (payload: unknown) => void) => listeners.get(event)?.delete(handler)),
    emit: (event: string, payload: unknown) => listeners.get(event)?.forEach((handler) => handler(payload)),
  }
}

const poll = {
  question: 'Куда идём?',
  answers: [{ text: 'В форум', emoji: null }, { text: 'В чат', emoji: null }],
  allow_multiselect: false,
  duration_seconds: 3600,
}

describe('publishPollMessage', () => {
  it('waits for the matching acknowledgement and returns the saved message', async () => {
    const transport = socket()
    const saved = { id: 91, channelId: 7, content: null, attachments: [] }
    const result = publishPollMessage({ channelId: 7, poll, nonce: 'poll-1', socket: transport })

    transport.emit('message_ack', { data: { client_nonce: 'other', message: { id: 1 } } })
    transport.emit('message_ack', { data: { client_nonce: 'poll-1', message: saved } })

    await expect(result).resolves.toMatchObject(saved)
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ client_nonce: 'poll-1', poll }))
    expect(transport.off).toHaveBeenCalledTimes(2)
  })

  it('reports an offline socket without leaving listeners behind', async () => {
    const transport = socket()
    transport.send.mockReturnValue(false)

    await expect(publishPollMessage({ channelId: 7, poll, nonce: 'poll-2', socket: transport }))
      .rejects.toThrow('Нет соединения')
    expect(transport.off).toHaveBeenCalledTimes(2)
  })
})
