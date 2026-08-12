import api from './api'

export interface OnboardingOption { id: string; label: string; description: string; channel_ids: number[] }
export interface OnboardingPrompt { id: string; title: string; required: boolean; multiple: boolean; options: OnboardingOption[] }
export interface OnboardingSettings {
  server_id: number; enabled: boolean; welcome_text?: string | null
  rules: { id: string; title: string; description: string }[]
  prompts: OnboardingPrompt[]; default_channel_ids: number[]
}
export interface MemberOnboardingSettings extends OnboardingSettings { completed: boolean }
export interface ScheduledEventState {
  id: number; server_id: number; creator_id: number; name: string; description?: string | null
  entity_type: 'voice' | 'external'; channel_id?: number | null; location?: string | null
  scheduled_start_at: string; scheduled_end_at?: string | null; status: string
  interested_count: number; interested: boolean
}
export interface AutoModRuleState {
  id: number; name: string; enabled: boolean; trigger_type: 'keyword' | 'spam' | 'mention_spam' | 'link'
  config: Record<string, unknown>; actions: { type: string; duration_seconds?: number }[]
}

export const serverFeatureService = {
  onboarding: async (serverId: number) => (await api.get<OnboardingSettings>(`/api/v1/servers/${serverId}/onboarding`)).data,
  memberOnboarding: async (serverId: number) => (await api.get<MemberOnboardingSettings>(`/api/v1/servers/${serverId}/onboarding/@me`)).data,
  completeOnboarding: async (serverId: number, acceptedRules: boolean, answers: Record<string, string[]>) => (
    await api.post<{ completed: boolean; selected_channel_ids: number[] }>(`/api/v1/servers/${serverId}/onboarding/@me/complete`, { accepted_rules: acceptedRules, answers })
  ).data,
  saveOnboarding: async (serverId: number, value: Omit<OnboardingSettings, 'server_id'>) => (await api.put<OnboardingSettings>(`/api/v1/servers/${serverId}/onboarding`, value)).data,
  events: async (serverId: number) => (await api.get<ScheduledEventState[]>(`/api/v1/servers/${serverId}/events`)).data,
  createEvent: async (serverId: number, value: Record<string, unknown>) => (await api.post<ScheduledEventState>(`/api/v1/servers/${serverId}/events`, value)).data,
  updateEvent: async (eventId: number, value: Record<string, unknown>) => (await api.patch<ScheduledEventState>(`/api/v1/events/${eventId}`, value)).data,
  cancelEvent: async (eventId: number) => api.delete(`/api/v1/events/${eventId}`),
  setInterest: async (eventId: number, interested: boolean) => interested ? api.put(`/api/v1/events/${eventId}/interest`) : api.delete(`/api/v1/events/${eventId}/interest`),
  automod: async (serverId: number) => (await api.get<AutoModRuleState[]>(`/api/v1/servers/${serverId}/automod`)).data,
  createAutoMod: async (serverId: number, value: Omit<AutoModRuleState, 'id'>) => (await api.post<AutoModRuleState>(`/api/v1/servers/${serverId}/automod`, value)).data,
  updateAutoMod: async (serverId: number, ruleId: number, value: Omit<AutoModRuleState, 'id'>) => (await api.put<AutoModRuleState>(`/api/v1/servers/${serverId}/automod/${ruleId}`, value)).data,
  deleteAutoMod: async (serverId: number, ruleId: number) => api.delete(`/api/v1/servers/${serverId}/automod/${ruleId}`),
}
