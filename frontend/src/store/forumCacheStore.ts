import { create } from 'zustand'

import { communityApi } from '../services/communityApi'
import type { Forum, ForumPostSummary } from '../types/community'

export interface ForumPostQuery {
  query?: string
  tag_ids?: number[]
  include_archived?: boolean
  sort?: 'latest_activity' | 'created_at'
  limit?: number
}

export interface ForumSnapshot {
  forum: Forum | null
  loaded: boolean
  refreshing: boolean
}

export interface ForumPostsSnapshot {
  posts: ForumPostSummary[]
  loaded: boolean
  refreshing: boolean
  revision: number
}

interface ForumCacheState {
  forums: Record<string, ForumSnapshot>
  postLists: Record<string, ForumPostsSnapshot>
  refreshForum: (ownerId: number, channelId: number) => Promise<Forum | null>
  refreshPosts: (ownerId: number, channelId: number, query: ForumPostQuery) => Promise<void>
  updatePosts: (
    ownerId: number,
    channelId: number,
    query: ForumPostQuery,
    update: (posts: ForumPostSummary[]) => ForumPostSummary[],
  ) => void
  clear: () => void
}

export const EMPTY_FORUM: ForumSnapshot = Object.freeze({
  forum: null, loaded: false, refreshing: false,
})
export const EMPTY_FORUM_POSTS: ForumPostsSnapshot = Object.freeze({
  posts: [], loaded: false, refreshing: false, revision: 0,
})

const forumRequests = new Map<string, Promise<Forum | null>>()
const postRequests = new Map<string, Promise<void>>()
const forumKey = (ownerId: number, channelId: number) => `${ownerId}:${channelId}`

export function forumPostsKey(ownerId: number, channelId: number, query: ForumPostQuery) {
  const tags = [...(query.tag_ids ?? [])].sort((left, right) => left - right).join(',')
  return `${forumKey(ownerId, channelId)}|${query.query ?? ''}|${tags}|${Number(Boolean(query.include_archived))}|${query.sort ?? ''}`
}

function reconcilePosts(
  server: ForumPostSummary[],
  current: ForumPostSummary[],
  baseline: ForumPostSummary[],
) {
  const baselineById = new Map(baseline.map((post) => [post.id, post]))
  const currentById = new Map(current.map((post) => [post.id, post]))
  const deleted = new Set(baseline.filter((post) => !currentById.has(post.id)).map((post) => post.id))
  const byId = new Map(server.filter((post) => !deleted.has(post.id)).map((post) => [post.id, post]))
  current.forEach((post) => {
    if (!baselineById.has(post.id) || baselineById.get(post.id) !== post) byId.set(post.id, post)
  })
  const ordered = server
    .filter((post) => !deleted.has(post.id))
    .map((post) => byId.get(post.id) ?? post)
  const orderedIds = new Set(ordered.map((post) => post.id))
  return [...ordered, ...current.filter((post) => !orderedIds.has(post.id) && !baselineById.has(post.id))]
}

export const useForumCacheStore = create<ForumCacheState>((set, get) => ({
  forums: {},
  postLists: {},
  refreshForum: async (ownerId, channelId) => {
    const key = forumKey(ownerId, channelId)
    const pending = forumRequests.get(key)
    if (pending) return pending
    set((state) => ({
      forums: { ...state.forums, [key]: { ...(state.forums[key] ?? EMPTY_FORUM), refreshing: true } },
    }))
    const request = communityApi.getForum(channelId).then((forum) => {
      set((state) => ({
        forums: { ...state.forums, [key]: { forum, loaded: true, refreshing: false } },
      }))
      return forum
    }).catch((error) => {
      set((state) => ({
        forums: {
          ...state.forums,
          [key]: { ...(state.forums[key] ?? EMPTY_FORUM), loaded: true, refreshing: false },
        },
      }))
      throw error
    }).finally(() => forumRequests.delete(key))
    forumRequests.set(key, request)
    return request
  },
  refreshPosts: async (ownerId, channelId, query) => {
    const key = forumPostsKey(ownerId, channelId, query)
    const pending = postRequests.get(key)
    if (pending) return pending
    const initial = get().postLists[key] ?? EMPTY_FORUM_POSTS
    const revision = initial.revision
    const baseline = initial.posts
    set((state) => ({
      postLists: {
        ...state.postLists,
        [key]: { ...(state.postLists[key] ?? EMPTY_FORUM_POSTS), refreshing: true },
      },
    }))
    const request = communityApi.listForumPosts(channelId, query).then((posts) => {
      set((state) => {
        const snapshot = state.postLists[key] ?? EMPTY_FORUM_POSTS
        return {
          postLists: {
            ...state.postLists,
            [key]: {
              ...snapshot,
              posts: snapshot.revision === revision
                ? posts
                : reconcilePosts(posts, snapshot.posts, baseline),
              loaded: true,
              refreshing: false,
            },
          },
        }
      })
    }).catch((error) => {
      set((state) => ({
        postLists: {
          ...state.postLists,
          [key]: { ...(state.postLists[key] ?? EMPTY_FORUM_POSTS), loaded: true, refreshing: false },
        },
      }))
      throw error
    }).finally(() => postRequests.delete(key))
    postRequests.set(key, request)
    return request
  },
  updatePosts: (ownerId, channelId, query, update) => {
    const key = forumPostsKey(ownerId, channelId, query)
    set((state) => {
      const snapshot = state.postLists[key] ?? EMPTY_FORUM_POSTS
      return {
        postLists: {
          ...state.postLists,
          [key]: {
            ...snapshot,
            posts: update(snapshot.posts),
            revision: snapshot.revision + 1,
          },
        },
      }
    })
  },
  clear: () => {
    forumRequests.clear()
    postRequests.clear()
    set({ forums: {}, postLists: {} })
  },
}))

export const forumCacheKey = forumKey
