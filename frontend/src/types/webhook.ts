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

export interface RichWebhookEmbed {
  title?: string | null
  type?: string | null
  description?: string | null
  url?: string | null
  timestamp?: string | null
  color?: number | null
  footer?: {
    text: string
    icon_url?: string | null
  } | null
  image?: {
    url: string
    width?: number | null
    height?: number | null
  } | null
  thumbnail?: {
    url: string
    width?: number | null
    height?: number | null
  } | null
  author?: {
    name: string
    url?: string | null
    icon_url?: string | null
  } | null
  fields?: Array<{
    name: string
    value: string
    inline?: boolean
  }>
}
