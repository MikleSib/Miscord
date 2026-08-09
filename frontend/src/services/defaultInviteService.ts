import serverService from './serverService'

const DEFAULT_INVITE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
const pendingByServer = new Map<number, ReturnType<typeof serverService.createInvite>>()

export function getOrCreateDefaultInvite(serverId: number) {
  const pending = pendingByServer.get(serverId)
  if (pending) return pending

  const request = serverService
    .createInvite(serverId, {
      max_age_seconds: DEFAULT_INVITE_MAX_AGE_SECONDS,
      max_uses: null,
      unique: false,
    })
    .finally(() => {
      pendingByServer.delete(serverId)
    })

  pendingByServer.set(serverId, request)
  return request
}
