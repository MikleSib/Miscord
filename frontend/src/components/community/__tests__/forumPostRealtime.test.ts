import { describe, expect, it } from 'vitest'
import { applyForumMessageCreated, applyForumMessageDeleted } from '../forumPostRealtime'
import type { ForumPostSummary } from '../../../types/community'

const post = {
  id: 25,
  starter_message_id: 100,
  message_count: 3,
  last_message_at: '2026-08-13T08:00:00Z',
} as ForumPostSummary

describe('forum post realtime counters', () => {
  it('increments replies immediately for a message in the post thread', () => {
    const updated = applyForumMessageCreated([post], {
      id: 104,
      text_channel_id: 25,
      timestamp: '2026-08-13T09:00:00Z',
    })

    expect(updated[0]).toMatchObject({ message_count: 4, last_message_at: '2026-08-13T09:00:00Z' })
  })

  it('does not count the starter and never decrements below it', () => {
    expect(applyForumMessageCreated([post], { id: 100, channelId: 25 })[0].message_count).toBe(3)
    const single = { ...post, message_count: 1 }
    expect(applyForumMessageDeleted([single], { message_id: 104, text_channel_id: 25 })[0].message_count).toBe(1)
  })
})
