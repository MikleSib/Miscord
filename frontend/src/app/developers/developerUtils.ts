import { Permissions, permissionBitfield } from '../../lib/permissions'

export function errorMessage(error: unknown): string {
  const candidate = error as { response?: { data?: { detail?: string | { message?: string } } } }
  const detail = candidate.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && detail.message) return detail.message
  return 'Не удалось выполнить операцию. Попробуйте ещё раз.'
}

export function normalizedPermissionDraft(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return String(Permissions.VIEW_CHANNELS + Permissions.SEND_MESSAGES)
  }
  const permissions = permissionBitfield(value)
  return (permissions & BigInt(Permissions.ADMINISTRATOR)) !== BigInt(0)
    ? String(Permissions.ADMINISTRATOR)
    : permissions.toString()
}
