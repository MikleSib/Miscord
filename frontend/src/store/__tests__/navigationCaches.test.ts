import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DirectMessage, User } from '../../types'

const mocks = vi.hoisted(() => ({
  getFriends: vi.fn(),
  getPendingRequests: vi.fn(),
  getConversations: vi.fn(),
  getMessages: vi.fn(),
}))

vi.mock('../../services/friendService', () => ({
  default: {
    getFriends: mocks.getFriends,
    getPendingRequests: mocks.getPendingRequests,
  },
}))

vi.mock('../../services/directMessageService', () => ({
  default: {
    getConversations: mocks.getConversations,
    getMessages: mocks.getMessages,
  },
}))

import { useChannelCategoryDataStore } from '../channelCategoryDataStore'
import { useDirectMessageHistoryStore } from '../directMessageHistoryStore'
import { useHomeNavigationStore } from '../homeNavigationStore'

const user = (id: number, username = `user-${id}`): User => ({
  id,
  username,
  email: `${username}@example.test`,
})

const message = (id: number, content: string): DirectMessage => ({
  id,
  content,
  timestamp: new Date(id * 1000).toISOString(),
  sender_id: 1,
  recipient_id: 2,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('navigation caches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChannelCategoryDataStore.getState().clear()
    useHomeNavigationStore.getState().clear()
    useDirectMessageHistoryStore.getState().clear()
  })

  it('keeps categories available after the sidebar component is remounted', () => {
    useChannelCategoryDataStore.getState().setCategories(7, [{
      id: 70,
      name: 'Команда',
      server_id: 7,
      position: 0,
    }])

    expect(useChannelCategoryDataStore.getState().categoriesByServer[7]?.[0].name)
      .toBe('Команда')
  })

  it('keeps home data visible while a background refresh is pending', async () => {
    const pendingFriends = deferred<User[]>()
    mocks.getFriends.mockReturnValue(pendingFriends.promise)
    mocks.getPendingRequests.mockResolvedValue([])
    mocks.getConversations.mockResolvedValue([])
    useHomeNavigationStore.getState().setFriends(1, [user(2, 'cached')])

    const refresh = useHomeNavigationStore.getState().refresh(1)
    expect(useHomeNavigationStore.getState().snapshots[1].friends[0].username).toBe('cached')

    useHomeNavigationStore.getState().setFriends(1, (friends) => [
      ...friends,
      user(3, 'realtime'),
    ])
    pendingFriends.resolve([user(2, 'stale-server-copy')])
    await refresh

    expect(useHomeNavigationStore.getState().snapshots[1].friends.map((item) => item.username))
      .toEqual(['cached', 'realtime'])
  })

  it('does not let DM revalidation replace cached realtime messages', async () => {
    mocks.getMessages.mockResolvedValueOnce([message(1, 'cached')])
    await useDirectMessageHistoryStore.getState().refresh(1, 2)

    const pendingHistory = deferred<DirectMessage[]>()
    mocks.getMessages.mockReturnValueOnce(pendingHistory.promise)
    const refresh = useDirectMessageHistoryStore.getState().refresh(1, 2)
    expect(useDirectMessageHistoryStore.getState().conversations['1:2'].messages)
      .toHaveLength(1)

    useDirectMessageHistoryStore.getState().updateMessages(1, 2, (messages) => [
      ...messages,
      message(2, 'realtime'),
    ])
    pendingHistory.resolve([message(1, 'updated by server')])
    await refresh

    const messages = useDirectMessageHistoryStore.getState().conversations['1:2'].messages
    expect(messages.map((item) => item.content)).toEqual(['cached', 'realtime'])
  })
})
