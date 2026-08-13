import type { ForumPostSummary } from '../../types/community'

interface MessageCreatedPayload {
  id?: number
  channelId?: number
  text_channel_id?: number
  timestamp?: string
  created_at?: string
}

interface MessageDeletedPayload {
  message_id?: number
  channelId?: number
  text_channel_id?: number
}

function channelId(payload: MessageCreatedPayload | MessageDeletedPayload): number | null {
  const value = payload.text_channel_id ?? payload.channelId
  return Number.isFinite(Number(value)) ? Number(value) : null
}

export function applyForumMessageCreated(
  posts: ForumPostSummary[],
  payload: MessageCreatedPayload,
): ForumPostSummary[] {
  const targetId = channelId(payload)
  if (targetId == null) return posts
  return posts.map((post) => {
    if (post.id !== targetId || post.starter_message_id === payload.id) return post
    return {
      ...post,
      message_count: post.message_count + 1,
      last_message_at: payload.timestamp ?? payload.created_at ?? post.last_message_at,
    }
  })
}

export function applyForumMessageDeleted(
  posts: ForumPostSummary[],
  payload: MessageDeletedPayload,
): ForumPostSummary[] {
  const targetId = channelId(payload)
  if (targetId == null) return posts
  return posts.map((post) => {
    if (post.id !== targetId || post.starter_message_id === payload.message_id) return post
    return { ...post, message_count: Math.max(1, post.message_count - 1) }
  })
}
