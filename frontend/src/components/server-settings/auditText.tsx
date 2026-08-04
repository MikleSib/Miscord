import React from 'react'
import {
  Ban,
  Crown,
  Hash,
  Link2,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Settings,
  Shield,
  Tag,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AuditLogEntry } from '../../types'

/** Человеческие названия действий для фильтра. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  server_update: 'Изменение сервера',
  channel_create: 'Создание канала',
  channel_update: 'Изменение канала',
  channel_delete: 'Удаление канала',
  member_join: 'Вступление участника',
  member_leave: 'Выход участника',
  member_kick: 'Исключение участника',
  member_ban: 'Блокировка участника',
  member_unban: 'Снятие блокировки',
  member_nickname_update: 'Изменение никнейма',
  member_role_add: 'Выдача роли',
  member_role_remove: 'Снятие роли',
  role_create: 'Создание роли',
  role_update: 'Изменение роли',
  role_delete: 'Удаление роли',
  role_reorder: 'Порядок ролей',
  invite_create: 'Создание приглашения',
  invite_delete: 'Отзыв приглашения',
  ownership_transfer: 'Передача владения',
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  server_update: Settings,
  channel_create: Hash,
  channel_update: Pencil,
  channel_delete: Trash2,
  member_join: LogIn,
  member_leave: LogOut,
  member_kick: UserMinus,
  member_ban: Ban,
  member_unban: Users,
  member_nickname_update: Tag,
  member_role_add: Plus,
  member_role_remove: Shield,
  role_create: Shield,
  role_update: Shield,
  role_delete: Trash2,
  role_reorder: Shield,
  invite_create: Link2,
  invite_delete: Link2,
  ownership_transfer: Crown,
}

export function auditIcon(action: string): LucideIcon {
  return ACTION_ICONS[action] ?? Settings
}

/** Действие обычным языком: «Аня исключила Петю». */
export function describeAudit(entry: AuditLogEntry): React.ReactNode {
  const actor = <strong>{entry.actor?.username || 'Система'}</strong>
  const target = entry.target_name ? <strong>{entry.target_name}</strong> : null
  const changes = entry.changes || {}

  switch (entry.action) {
    case 'server_update':
      return (
        <>
          {actor} изменил настройки сервера
          {describeServerChanges(changes)}
        </>
      )
    case 'channel_create':
      return <>{actor} создал канал {target}</>
    case 'channel_update':
      return <>{actor} изменил канал {target}</>
    case 'channel_delete':
      return <>{actor} удалил канал {target}</>
    case 'member_join':
      return (
        <>
          {actor} присоединился к серверу
          {changes.invite_code ? <> по приглашению <code>{changes.invite_code}</code></> : null}
        </>
      )
    case 'member_leave':
      return <>{actor} покинул сервер</>
    case 'member_kick':
      return <>{actor} исключил {target}</>
    case 'member_ban':
      return <>{actor} заблокировал {target}</>
    case 'member_unban':
      return <>{actor} снял блокировку с {target}</>
    case 'member_nickname_update':
      return changes.nickname ? (
        <>
          {actor} сменил никнейм {target} на «{String(changes.nickname)}»
        </>
      ) : (
        <>{actor} убрал никнейм у {target}</>
      )
    case 'member_role_add':
      return (
        <>
          {actor} выдал роль «{String(changes.role_name ?? '—')}» участнику {target}
        </>
      )
    case 'member_role_remove':
      return (
        <>
          {actor} снял роль «{String(changes.role_name ?? '—')}» с участника {target}
        </>
      )
    case 'role_create':
      return <>{actor} создал роль {target}</>
    case 'role_update':
      return <>{actor} изменил роль {target}</>
    case 'role_delete':
      return <>{actor} удалил роль {target}</>
    case 'role_reorder':
      return <>{actor} изменил порядок ролей</>
    case 'invite_create':
      return <>{actor} создал приглашение <code>{entry.target_name}</code></>
    case 'invite_delete':
      return <>{actor} отозвал приглашение <code>{entry.target_name}</code></>
    case 'ownership_transfer':
      return <>{actor} передал владение сервером участнику {target}</>
    default:
      return (
        <>
          {actor} — {AUDIT_ACTION_LABELS[entry.action] || entry.action}
          {target ? <> ({target})</> : null}
        </>
      )
  }
}

const SERVER_FIELD_LABELS: Record<string, string> = {
  name: 'название',
  description: 'описание',
  icon: 'иконку',
  banner: 'баннер',
  is_public: 'публичность',
}

function describeServerChanges(changes: Record<string, any>): React.ReactNode {
  const fields = Object.keys(changes)
    .map((key) => SERVER_FIELD_LABELS[key])
    .filter(Boolean)

  if (fields.length === 0) return null
  return <>: {fields.join(', ')}</>
}
