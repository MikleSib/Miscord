import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveOutgoingRecord: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../../lib/outgoingMessageDb', () => ({
  clearOutgoingRecords: vi.fn(async () => undefined),
  deleteOutgoingRecord: vi.fn(async () => undefined),
  loadOutgoingRecords: vi.fn(async () => []),
  saveOutgoingRecord: mocks.saveOutgoingRecord,
}))

vi.mock('../../services/uploadService', () => ({
  default: {
    deleteUpload: vi.fn(async () => undefined),
    uploadFile: vi.fn(),
  },
}))

vi.mock('../../services/unifiedWebSocketService', () => ({
  default: {
    connect: vi.fn(),
    isConnected: vi.fn(() => true),
    on: vi.fn(),
    onConnectionStatusChange: vi.fn(),
    send: mocks.send,
  },
}))

import { useOutgoingMessageStore } from '../outgoingMessageStore'

describe('outgoing message queue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      clearTimeout,
      setTimeout,
    })
    mocks.saveOutgoingRecord.mockReset()
    mocks.saveOutgoingRecord.mockResolvedValue(undefined)
    mocks.send.mockReset()
    mocks.send.mockReturnValue(true)
    useOutgoingMessageStore.setState({
      initializedUserId: 1,
      messages: [],
      persistenceWarning: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends a local DM without waiting for IndexedDB persistence', async () => {
    mocks.saveOutgoingRecord.mockReturnValue(new Promise<void>(() => undefined))

    const clientNonce = useOutgoingMessageStore.getState().enqueue({
      userId: 1,
      conversation: { type: 'dm', id: 2 },
      content: 'привет',
    })
    await Promise.resolve()

    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dm_message',
      recipient_id: 2,
      client_nonce: clientNonce,
      content: 'привет',
    }))
    expect(useOutgoingMessageStore.getState().messages[0]?.phase).toBe('awaiting_ack')
  })

  it('does not let an older unconfirmed DM block a new queued message', async () => {
    useOutgoingMessageStore.setState({
      messages: [{
        clientNonce: 'old-unconfirmed',
        userId: 1,
        conversation: { type: 'dm', id: 2 },
        content: 'already stored by the server',
        createdAt: '2026-08-13T10:00:00.000Z',
        phase: 'awaiting_ack',
        attachments: [],
        sendAttempt: 0,
      }],
    })

    const clientNonce = useOutgoingMessageStore.getState().enqueue({
      userId: 1,
      conversation: { type: 'dm', id: 2 },
      content: 'new message',
    })
    await Promise.resolve()

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dm_message',
      recipient_id: 2,
      client_nonce: clientNonce,
      content: 'new message',
    }))
    expect(useOutgoingMessageStore.getState().messages.find((message) => message.clientNonce === clientNonce)?.phase)
      .toBe('awaiting_ack')
  })
})
