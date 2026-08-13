import { create } from 'zustand'

import serverService from '../services/serverService'
import type { Role, ServerMember } from '../types'

export interface ServerMemberSnapshot {
  members: ServerMember[]
  roles: Role[]
  loaded: boolean
  refreshing: boolean
  revision: number
  onlineOverrides: Record<number, boolean>
}

interface ServerMemberCacheState {
  servers: Record<string, ServerMemberSnapshot>
  refresh: (ownerId: number, serverId: number) => Promise<void>
  setOnline: (ownerId: number, serverId: number, userId: number, online: boolean) => void
  updateMember: (ownerId: number, serverId: number, member: ServerMember) => void
  removeMember: (ownerId: number, serverId: number, userId: number) => void
  clear: () => void
}

export const EMPTY_SERVER_MEMBERS: ServerMemberSnapshot = Object.freeze({
  members: [], roles: [], loaded: false, refreshing: false, revision: 0, onlineOverrides: {},
})

const requests = new Map<string, Promise<void>>()
export const serverMemberCacheKey = (ownerId: number, serverId: number) => `${ownerId}:${serverId}`

export const useServerMemberCacheStore = create<ServerMemberCacheState>((set, get) => {
  const patch = (
    key: string,
    update: (snapshot: ServerMemberSnapshot) => ServerMemberSnapshot,
  ) => set((state) => ({
    servers: { ...state.servers, [key]: update(state.servers[key] ?? EMPTY_SERVER_MEMBERS) },
  }))

  return {
    servers: {},
    refresh: async (ownerId, serverId) => {
      const key = serverMemberCacheKey(ownerId, serverId)
      const pending = requests.get(key)
      if (pending) return pending
      const revision = (get().servers[key] ?? EMPTY_SERVER_MEMBERS).revision
      patch(key, (snapshot) => ({ ...snapshot, refreshing: true }))
      const request = Promise.all([
        serverService.getMembers(serverId),
        serverService.getRoles(serverId),
      ]).then(([memberResult, roles]) => {
        patch(key, (snapshot) => {
          if (snapshot.revision !== revision) {
            return { ...snapshot, loaded: true, refreshing: false }
          }
          const members = memberResult.members.map((member) => {
            const online = snapshot.onlineOverrides[member.user_id]
            return online == null ? member : { ...member, is_online: online }
          })
          return { ...snapshot, members, roles, loaded: true, refreshing: false }
        })
      }).catch((error) => {
        patch(key, (snapshot) => ({ ...snapshot, loaded: true, refreshing: false }))
        throw error
      }).finally(() => requests.delete(key))
      requests.set(key, request)
      return request
    },
    setOnline: (ownerId, serverId, userId, online) => {
      const key = serverMemberCacheKey(ownerId, serverId)
      patch(key, (snapshot) => ({
        ...snapshot,
        members: snapshot.members.map((member) => (
          member.user_id === userId ? { ...member, is_online: online } : member
        )),
        onlineOverrides: { ...snapshot.onlineOverrides, [userId]: online },
      }))
    },
    updateMember: (ownerId, serverId, member) => {
      const key = serverMemberCacheKey(ownerId, serverId)
      patch(key, (snapshot) => ({
        ...snapshot,
        members: snapshot.members.some((item) => item.user_id === member.user_id)
          ? snapshot.members.map((item) => item.user_id === member.user_id ? member : item)
          : [...snapshot.members, member],
        revision: snapshot.revision + 1,
      }))
    },
    removeMember: (ownerId, serverId, userId) => {
      const key = serverMemberCacheKey(ownerId, serverId)
      patch(key, (snapshot) => ({
        ...snapshot,
        members: snapshot.members.filter((member) => member.user_id !== userId),
        revision: snapshot.revision + 1,
      }))
    },
    clear: () => {
      requests.clear()
      set({ servers: {} })
    },
  }
})
