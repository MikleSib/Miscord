export type ThreadKind = 'public_thread' | 'private_thread' | 'forum_post'

export interface Thread {
  id: number
  name: string
  server_id: number
  parent_id: number
  owner_id: number | null
  kind: ThreadKind
  archived_at: string | null
  locked: boolean
  auto_archive_minutes: number
  last_message_at: string | null
  created_at: string
  member_count: number
  joined: boolean
  tag_ids?: number[]
  starter_message_id?: number | null
}

export interface ForumTag {
  id: number
  name: string
  emoji: string | null
  moderated: boolean
  position: number
}

export interface Forum {
  id: number
  server_id: number
  name: string
  kind: 'forum'
  category_id: number | null
  position: number
  created_at: string
  settings: {
    guidelines: string | null
    default_layout: 'list' | 'gallery'
    default_sort: 'latest_activity' | 'created_at'
    require_tag: boolean
    auto_archive_minutes: number
    slow_mode_seconds: number
  }
  tags: ForumTag[]
}

export interface PollAnswer {
  id: number
  text: string
  emoji: string | null
  position: number
  selected: boolean
  vote_count: number | null
}

export interface Poll {
  id: number
  message_id: number
  question: string
  allow_multiselect: boolean
  expires_at: string
  closed_at: string | null
  closed: boolean
  total_voters: number | null
  answers: PollAnswer[]
}

export type NotificationType =
  | 'mention'
  | 'reply'
  | 'thread_reply'
  | 'reaction'
  | 'friend_request'
  | 'server_invite'
  | 'application_response'

export interface InboxNotification {
  id: number
  type: NotificationType
  actor_user_id: number | null
  server_id: number | null
  channel_id: number | null
  message_id: number | null
  payload: Record<string, unknown>
  created_at: string
  read_at: string | null
}

export interface ServerTemplateSummary {
  id: string
  kind: 'builtin' | 'user'
  name: string
  description: string | null
  icon?: string | null
  schema_version: number
  source_server_id?: number | null
}

export interface ServerTemplatePreview extends ServerTemplateSummary {
  categories: Array<{ key: string; name: string; position: number }>
  channels: Array<{
    key: string
    type: 'text' | 'voice' | 'forum'
    name: string
    category_key?: string | null
    position: number
  }>
  roles: Array<{ key: string; name: string; color?: string | null; position: number }>
}
