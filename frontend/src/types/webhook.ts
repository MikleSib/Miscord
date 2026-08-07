export interface WebhookCreator {
  id: number
  username: string
  display_name: string | null
  avatar_url: string | null
}

export interface IncomingWebhook {
  id: number
  type: 1
  server_id: number
  channel_id: number
  name: string
  avatar_url: string | null
  creator: WebhookCreator | null
  created_at: string
  updated_at: string
  token?: string
  execution_url?: string
}

export interface WebhookExecutionUrl {
  execution_url: string
}

export interface WebhookUpdatePayload {
  name?: string
  avatar_url?: string | null
  channel_id?: number
}