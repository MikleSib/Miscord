import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '../../types'

const { loadMessageHistoryMock } = vi.hoisted(() => ({
  loadMessageHistoryMock: vi.fn(),
}))

vi.mock('../../services/chatService', () => ({
  default: { loadMessageHistory: loadMessageHistoryMock },
}))

import { useChatStore } from '../chatStore'

function message(id: number, channelId: number): Message {
  return {
    id,
    channelId,
    content: `message-${id}`,
    timestamp: new Date(id * 1000).toISOString(),
    attachments: [],
    author: { id: 1, username: 'misha', email: '' },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let ownerId = 100

beforeEach(() => {
  loadMessageHistoryMock.mockReset()
  ownerId += 1
  useChatStore.getState().setCacheOwner(ownerId)
})

describe('chat history cache', () => {
  it('shows a visited channel immediately while refreshing it in the background', async () => {
    loadMessageHistoryMock.mockResolvedValueOnce({ messages: [message(1, 10)], has_more: false })
    useChatStore.getState().activateChannel(10)
    await useChatStore.getState().loadMessageHistory(10)

    useChatStore.getState().activateChannel(20)
    const refresh = deferred<{ messages: Message[]; has_more: boolean }>()
    loadMessageHistoryMock.mockReturnValueOnce(refresh.promise)
    useChatStore.getState().activateChannel(10)
    const request = useChatStore.getState().loadMessageHistory(10)

    expect(useChatStore.getState()).toMatchObject({
      currentChannelId: 10,
      messages: [expect.objectContaining({ id: 1 })],
      isLoading: false,
      isRefreshing: true,
    })

    refresh.resolve({ messages: [message(1, 10), message(2, 10)], has_more: false })
    await request
    expect(useChatStore.getState().messages.map((item) => item.id)).toEqual([1, 2])
  })

  it('never paints a late response from the previously selected channel', async () => {
    const first = deferred<{ messages: Message[]; has_more: boolean }>()
    const second = deferred<{ messages: Message[]; has_more: boolean }>()
    loadMessageHistoryMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    useChatStore.getState().activateChannel(10)
    const firstRequest = useChatStore.getState().loadMessageHistory(10)
    useChatStore.getState().activateChannel(20)
    const secondRequest = useChatStore.getState().loadMessageHistory(20)
    first.resolve({ messages: [message(1, 10)], has_more: false })
    await firstRequest

    expect(useChatStore.getState()).toMatchObject({
      currentChannelId: 20,
      messages: [],
      isLoading: true,
    })

    second.resolve({ messages: [message(2, 20)], has_more: false })
    await secondRequest
    expect(useChatStore.getState().messages.map((item) => item.id)).toEqual([2])
  })

  it('keeps realtime messages received while the REST refresh is pending', async () => {
    loadMessageHistoryMock.mockResolvedValueOnce({ messages: [message(10, 30)], has_more: false })
    useChatStore.getState().activateChannel(30)
    await useChatStore.getState().loadMessageHistory(30)

    const refresh = deferred<{ messages: Message[]; has_more: boolean }>()
    loadMessageHistoryMock.mockReturnValueOnce(refresh.promise)
    const request = useChatStore.getState().loadMessageHistory(30)
    useChatStore.getState().addMessage(message(11, 30))
    refresh.resolve({ messages: [message(10, 30)], has_more: false })
    await request

    expect(useChatStore.getState().messages.map((item) => item.id)).toEqual([10, 11])
  })

  it('clears message content when the signed-in account changes', async () => {
    loadMessageHistoryMock.mockResolvedValueOnce({ messages: [message(1, 10)], has_more: false })
    useChatStore.getState().activateChannel(10)
    await useChatStore.getState().loadMessageHistory(10)

    useChatStore.getState().setCacheOwner(ownerId + 1000)
    expect(useChatStore.getState()).toMatchObject({
      currentChannelId: null,
      messages: [],
      channelCache: {},
    })
  })
})
