import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Message, Role, ServerMember } from '../../types'
import type { Forum, ForumPostSummary, InboxNotification, Thread } from '../../types/community'

const mocks = vi.hoisted(() => ({
  getChannelMessages: vi.fn(),
  listThreads: vi.fn(),
  getForum: vi.fn(),
  listForumPosts: vi.fn(),
  listNotifications: vi.fn(),
  unreadNotificationCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  deleteNotification: vi.fn(),
  getMembers: vi.fn(),
  getRoles: vi.fn(),
  listPins: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  channelApi: { getChannelMessages: mocks.getChannelMessages },
}))
vi.mock('../../services/communityApi', () => ({
  communityApi: {
    listThreads: mocks.listThreads,
    getForum: mocks.getForum,
    listForumPosts: mocks.listForumPosts,
    listNotifications: mocks.listNotifications,
    unreadNotificationCount: mocks.unreadNotificationCount,
    markNotificationRead: mocks.markNotificationRead,
    markAllNotificationsRead: mocks.markAllNotificationsRead,
    deleteNotification: mocks.deleteNotification,
  },
}))
vi.mock('../../services/serverService', () => ({
  default: { getMembers: mocks.getMembers, getRoles: mocks.getRoles },
}))
vi.mock('../../services/pinService', () => ({
  default: { list: mocks.listPins },
}))

import { useCommunityStore } from '../communityStore'
import { forumPostsKey, useForumCacheStore } from '../forumCacheStore'
import { pinnedMessageCacheKey, usePinnedMessageCacheStore } from '../pinnedMessageCacheStore'
import { secretDmHistoryKey, useSecretDmHistoryStore } from '../secretDmHistoryStore'
import { serverMemberCacheKey, useServerMemberCacheStore } from '../serverMemberCacheStore'
import { threadNavigationKey, useThreadNavigationStore } from '../threadNavigationStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const author = { id: 1, username: 'owner', email: 'owner@example.test' }
const message = (id: number, content: string): Message => ({
  id, content, author, timestamp: new Date(id * 1000).toISOString(), attachments: [],
})
const thread = (id: number): Thread => ({
  id, name: `thread-${id}`, server_id: 1, parent_id: 10, owner_id: 1,
  kind: 'public_thread', archived_at: null, locked: false, auto_archive_minutes: 1440,
  last_message_at: null, created_at: new Date(id * 1000).toISOString(), member_count: 1,
  joined: true,
})
const post = (id: number, count: number): ForumPostSummary => ({
  ...thread(id), kind: 'forum_post', preview: null, message_count: count, owner: null,
})
const notification = (id: number, type: InboxNotification['type']): InboxNotification => ({
  id, type, actor_user_id: 2, server_id: 1, channel_id: 10, message_id: id,
  payload: {}, created_at: new Date(id * 1000).toISOString(), read_at: null,
})
const role: Role = {
  id: 1, server_id: 1, name: 'member', position: 0, permissions: 0, is_default: true,
}
const member = (userId: number, username: string): ServerMember => ({
  id: userId, user_id: userId, username, is_owner: false, roles: [role], role_ids: [role.id],
  top_role_position: 0, permissions: 0,
})

describe('synchronization caches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useThreadNavigationStore.getState().clear()
    useForumCacheStore.getState().clear()
    useServerMemberCacheStore.getState().clear()
    usePinnedMessageCacheStore.getState().clear()
    useSecretDmHistoryStore.getState().clear()
    useCommunityStore.getState().setNotificationOwner(999)
    useCommunityStore.getState().setNotificationOwner(1)
    mocks.unreadNotificationCount.mockResolvedValue(0)
  })

  it('keeps thread history visible and preserves realtime changes during refresh', async () => {
    mocks.getChannelMessages.mockResolvedValueOnce({ messages: [message(1, 'cached')] })
    await useThreadNavigationStore.getState().refreshHistory(1, 20)
    const pending = deferred<{ messages: Message[] }>()
    mocks.getChannelMessages.mockReturnValueOnce(pending.promise)
    const refresh = useThreadNavigationStore.getState().refreshHistory(1, 20)
    const key = threadNavigationKey(1, 20)
    expect(useThreadNavigationStore.getState().histories[key].messages[0].content).toBe('cached')

    useThreadNavigationStore.getState().updateMessages(1, 20, (items) => [
      ...items, message(2, 'realtime'),
    ])
    pending.resolve({ messages: [message(1, 'server')] })
    await refresh

    expect(useThreadNavigationStore.getState().histories[key].messages.map((item) => item.content))
      .toEqual(['server', 'realtime'])
  })

  it('keeps forum posts visible while revalidating and does not drop a realtime update', async () => {
    const query = { sort: 'latest_activity' as const, limit: 100 }
    mocks.listForumPosts.mockResolvedValueOnce([post(1, 1)])
    await useForumCacheStore.getState().refreshPosts(1, 30, query)
    const pending = deferred<ForumPostSummary[]>()
    mocks.listForumPosts.mockReturnValueOnce(pending.promise)
    const refresh = useForumCacheStore.getState().refreshPosts(1, 30, query)
    const key = forumPostsKey(1, 30, query)
    expect(useForumCacheStore.getState().postLists[key].posts).toHaveLength(1)

    useForumCacheStore.getState().updatePosts(1, 30, query, (items) => (
      items.map((item) => ({ ...item, message_count: 2 }))
    ))
    pending.resolve([post(1, 1)])
    await refresh
    expect(useForumCacheStore.getState().postLists[key].posts[0].message_count).toBe(2)
  })

  it('isolates member lists by server and rejects a stale response after a local update', async () => {
    mocks.getMembers.mockResolvedValueOnce({ members: [member(1, 'one')] })
      .mockResolvedValueOnce({ members: [member(2, 'two')] })
    mocks.getRoles.mockResolvedValue([role])
    await useServerMemberCacheStore.getState().refresh(1, 10)
    await useServerMemberCacheStore.getState().refresh(1, 11)

    const pending = deferred<{ members: ServerMember[] }>()
    mocks.getMembers.mockReturnValueOnce(pending.promise)
    const refresh = useServerMemberCacheStore.getState().refresh(1, 10)
    useServerMemberCacheStore.getState().updateMember(1, 10, member(1, 'realtime'))
    pending.resolve({ members: [member(1, 'stale')] })
    await refresh

    expect(useServerMemberCacheStore.getState().servers[serverMemberCacheKey(1, 10)].members[0].username)
      .toBe('realtime')
    expect(useServerMemberCacheStore.getState().servers[serverMemberCacheKey(1, 11)].members[0].username)
      .toBe('two')
  })

  it('keeps pinned messages visible during a background refresh', async () => {
    mocks.listPins.mockResolvedValueOnce({ messages: [message(1, 'pin')], can_manage: true, limit: 50 })
    await usePinnedMessageCacheStore.getState().refresh(1, 10)
    const pending = deferred<{ messages: Message[]; can_manage: boolean; limit: number }>()
    mocks.listPins.mockReturnValueOnce(pending.promise)
    const refresh = usePinnedMessageCacheStore.getState().refresh(1, 10)
    const key = pinnedMessageCacheKey(1, 10)
    expect(usePinnedMessageCacheStore.getState().channels[key].messages[0].content).toBe('pin')
    pending.resolve({ messages: [message(1, 'pin')], can_manage: true, limit: 50 })
    await refresh
  })

  it('keeps decrypted secret messages only in the user-scoped memory cache', async () => {
    const first = { ...message(1, 'secret'), sender_id: 1, recipient_id: 2 } as any
    await useSecretDmHistoryStore.getState().refresh(1, 2, async () => ({
      messages: [first], peerReady: true,
    }))
    const pending = deferred<{ messages: any[]; peerReady: boolean }>()
    const refresh = useSecretDmHistoryStore.getState().refresh(1, 2, () => pending.promise)
    useSecretDmHistoryStore.getState().updateMessages(1, 2, (items) => [
      ...items, { ...first, id: 2, content: 'realtime' },
    ])
    pending.resolve({ messages: [first], peerReady: true })
    await refresh
    expect(useSecretDmHistoryStore.getState().conversations[secretDmHistoryKey(1, 2)].messages)
      .toHaveLength(2)
  })

  it('does not let an old Inbox filter response replace the active filter', async () => {
    const all = deferred<{ items: InboxNotification[]; next_cursor: number | null }>()
    const mentions = deferred<{ items: InboxNotification[]; next_cursor: number | null }>()
    mocks.listNotifications.mockReturnValueOnce(all.promise).mockReturnValueOnce(mentions.promise)
    const allRequest = useCommunityStore.getState().loadNotifications(true)
    useCommunityStore.getState().setNotificationFilter('mention')
    const mentionRequest = useCommunityStore.getState().loadNotifications(true)
    mentions.resolve({ items: [notification(2, 'mention')], next_cursor: null })
    await mentionRequest
    all.resolve({ items: [notification(1, 'reply')], next_cursor: null })
    await allRequest

    expect(useCommunityStore.getState().notificationFilter).toBe('mention')
    expect(useCommunityStore.getState().notifications.map((item) => item.id)).toEqual([2])
  })

  it('does not overwrite a realtime Inbox notification during reset refresh', async () => {
    mocks.listNotifications.mockResolvedValueOnce({ items: [notification(1, 'reply')], next_cursor: null })
    await useCommunityStore.getState().loadNotifications(true)
    const pending = deferred<{ items: InboxNotification[]; next_cursor: number | null }>()
    mocks.listNotifications.mockReturnValueOnce(pending.promise)
    const refresh = useCommunityStore.getState().loadNotifications(true)
    useCommunityStore.getState().receiveNotification(notification(2, 'mention'))
    pending.resolve({ items: [notification(1, 'reply')], next_cursor: null })
    await refresh
    expect(useCommunityStore.getState().notifications.map((item) => item.id)).toEqual([2, 1])
  })
})
