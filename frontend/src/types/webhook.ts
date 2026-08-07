export interface WebhookCreator {
  id: number
  username: string
  display_name?: string | null
  avatar_url?: string | null
}

export interface IncomingWebhook {
  id: number
  type: 1
  server_id: number
  channel_id: number
  name: string
  avatar_url?: string | null
  creator?: WebhookCreator | null
  created_at: string
  updated_at: string
}

export interface WebhookCreateResult extends IncomingWebhook {
  execution_url: string
}

export interface RichWebhookEmbed {
  title?: string
  description?: string
  url?: string
  timestamp?: string
  color?: number
  footer?: { text: string; icon_url?: string }
  image?: { url: string }
  thumbnail?: { url: string }
  author?: { name: string; url?: string; icon_url?: string }
  fields?: { name: string; value: string; inline?: boolean }[]
}

