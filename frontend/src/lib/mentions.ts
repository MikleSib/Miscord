import { Permissions, hasPermission } from './permissions'
import { ServerMember } from '../types'

/** Внутренний формат хранения упоминания: <@123> */
export const MENTION_TOKEN_RE = /<@(\d+)>/g

export type MentionCandidate = {
  id: number
  username: string
  displayName: string
  avatar_url?: string | null
  color?: string | null
  is_online?: boolean
}

export function getMemberMentionId(member: ServerMember | { id: number; user_id?: number }): number {
  return 'user_id' in member && member.user_id ? member.user_id : member.id
}

export function getMemberDisplayName(member: {
  nickname?: string | null
  display_name?: string | null
  username: string
}): string {
  return member.nickname || member.display_name || member.username
}

/** Участники сервера, у которых есть право видеть каналы. */
export function toMentionCandidates(members: ServerMember[]): MentionCandidate[] {
  return members
    .filter((member) => {
      if (member.is_owner) return true
      return hasPermission(member.permissions, Permissions.VIEW_CHANNELS)
    })
    .map((member) => ({
      id: getMemberMentionId(member),
      username: member.username,
      displayName: getMemberDisplayName(member),
      avatar_url: member.avatar_url,
      color: member.color,
      is_online: member.is_online,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
}

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string
): MentionCandidate[] {
  const q = query.trim().toLowerCase()
  if (!q) return candidates.slice(0, 12)

  return candidates
    .filter((candidate) => {
      const display = candidate.displayName.toLowerCase()
      const username = candidate.username.toLowerCase()
      return display.includes(q) || username.includes(q)
    })
    .slice(0, 12)
}

/** Ищет активный ввод @имя перед курсором. */
export function getActiveMentionQuery(
  value: string,
  caret: number
): { start: number; query: string } | null {
  const before = value.slice(0, caret)
  const match = before.match(/(^|[\s([{])@([^\s@]*)$/)
  if (!match) return null

  const atIndex = before.lastIndexOf('@')
  return {
    start: atIndex,
    query: match[2] ?? '',
  }
}

/** Вставляет @логин (уникальный, без пробелов) — перед отправкой станет <@id>. */
export function insertMentionHandle(
  value: string,
  caret: number,
  mentionStart: number,
  username: string
): { value: string; caret: number } {
  const token = `@${username} `
  const next = value.slice(0, mentionStart) + token + value.slice(caret)
  return {
    value: next,
    caret: mentionStart + token.length,
  }
}

/** Надёжный токен с id — если логин неудобен (пробелы и т.п.). */
export function insertMentionToken(
  value: string,
  caret: number,
  mentionStart: number,
  userId: number
): { value: string; caret: number } {
  const token = `<@${userId}> `
  const next = value.slice(0, mentionStart) + token + value.slice(caret)
  return {
    value: next,
    caret: mentionStart + token.length,
  }
}

/**
 * Перед отправкой: превращает «сырые» @Имя в <@id>, если имя однозначно
 * совпало с участником (на случай, если человек дописал вручную).
 */
export function serializeLooseMentions(content: string, candidates: MentionCandidate[]): string {
  if (!content || candidates.length === 0) return content

  // Сначала самые длинные имена, чтобы «Иван Петров» не резался на «Иван»
  const sorted = [...candidates].sort((a, b) => b.displayName.length - a.displayName.length)

  let result = content
  for (const candidate of sorted) {
    const names = Array.from(
      new Set([candidate.displayName, candidate.username].filter(Boolean))
    )
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(^|[\\s([{])@${escaped}(?=$|[\\s.,!?;:)\\]})])`, 'gi')
      result = result.replace(re, (_full, prefix: string) => `${prefix}<@${candidate.id}>`)
    }
  }
  return result
}

export function extractMentionIds(content: string | null | undefined): number[] {
  if (!content) return []
  const ids: number[] = []
  const seen = new Set<number>()
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    const id = Number(match[1])
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function contentMentionsUser(
  content: string | null | undefined,
  userId: number | undefined
): boolean {
  if (!content || !userId) return false
  return content.includes(`<@${userId}>`)
}

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; userId: number; label: string; isSelf: boolean }

export function splitMessageMentions(
  content: string,
  resolveLabel: (userId: number) => string,
  currentUserId?: number
): MentionSegment[] {
  const segments: MentionSegment[] = []
  let lastIndex = 0
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g')
  let match: RegExpExecArray | null

  while ((match = re.exec(content)) !== null) {
    const index = match.index
    if (index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, index) })
    }
    const userId = Number(match[1])
    segments.push({
      type: 'mention',
      userId,
      label: resolveLabel(userId),
      isSelf: currentUserId === userId,
    })
    lastIndex = index + match[0].length
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: content }]
}
