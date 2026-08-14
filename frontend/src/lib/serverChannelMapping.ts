import type { Channel } from '../types'

interface RawServerChannel {
  id: number
  name: string
  type?: 'text' | 'voice'
  position?: number
  category_id?: number | null
  slow_mode_seconds?: number
  kind?: Channel['kind']
  parent_id?: number | null
  max_users?: number
  bitrate?: number
  video_quality?: 'auto' | '720p'
}

/** Maps every server API channel through one path so persisted placement survives reloads. */
export function mapServerChannel(
  serverId: number,
  raw: RawServerChannel,
  type: 'text' | 'voice' = raw.type ?? 'text',
): Channel {
  const common = {
    id: raw.id,
    name: raw.name,
    type,
    serverId,
    position: raw.position ?? 0,
    category_id: raw.category_id ?? null,
  }

  if (type === 'voice') {
    return {
      ...common,
      type: 'voice',
      kind: raw.kind ?? 'voice',
      max_users: raw.max_users ?? 0,
      bitrate: raw.bitrate ?? 64,
      video_quality: raw.video_quality === '720p' ? '720p' : 'auto',
    }
  }

  return {
    ...common,
    type: 'text',
    slow_mode_seconds: raw.slow_mode_seconds ?? 0,
    kind: raw.kind ?? 'text',
    parent_id: raw.parent_id ?? null,
  }
}
