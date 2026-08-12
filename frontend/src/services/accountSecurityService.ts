import api from './api'

export interface AccountSession {
  id: string
  user_agent?: string | null
  ip_address?: string | null
  created_at: string
  last_seen_at: string
  expires_at: string
  current: boolean
}

export const accountSecurityService = {
  sessions: async () => (await api.get<AccountSession[]>('/api/v1/auth/sessions')).data,
  revokeSession: async (id: string) => api.delete(`/api/v1/auth/sessions/${id}`),
  revokeOthers: async () => (await api.post<{ revoked: number }>('/api/v1/auth/sessions/revoke-all')).data,
  startEmailChange: async (newEmail: string, currentPassword: string) => (
    await api.post<{ challenge_id: string; masked_email: string }>('/api/v1/auth/email-change/start', {
      new_email: newEmail, current_password: currentPassword,
    })
  ).data,
  finishEmailChange: async (challengeId: string, code: string) => (
    await api.post('/api/v1/auth/email-change/finish', { challenge_id: challengeId, code })
  ).data,
  twoFactorStatus: async () => (
    await api.get<{ enabled: boolean; backup_codes_remaining: number }>('/api/v1/auth/2fa')
  ).data,
  setupTwoFactor: async (currentPassword: string) => (
    await api.post<{ challenge_id: string; secret: string; otpauth_uri: string }>('/api/v1/auth/2fa/setup', {
      current_password: currentPassword,
    })
  ).data,
  enableTwoFactor: async (challengeId: string, code: string) => (
    await api.post<{ backup_codes: string[]; reauthentication_required: boolean }>('/api/v1/auth/2fa/enable', {
      challenge_id: challengeId, code,
    })
  ).data,
  disableTwoFactor: async (currentPassword: string, code: string) => api.delete('/api/v1/auth/2fa', {
    data: { current_password: currentPassword, code },
  }),
  regenerateBackupCodes: async (currentPassword: string, code: string) => (
    await api.post<{ backup_codes: string[] }>('/api/v1/auth/2fa/backup-codes', {
      current_password: currentPassword, code,
    })
  ).data,
}
