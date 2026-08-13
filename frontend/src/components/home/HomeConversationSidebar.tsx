'use client'

import { useMemo, useState } from 'react'
import { Search, Users, X } from 'lucide-react'

import type { User } from '../../types'
import { UserAvatar } from '../ui/user-avatar'

interface HomeConversationSidebarProps {
  conversations: User[]
  pendingCount: number
  selectedUserId?: number
  hidingUserId?: number
  onOpenFriends: () => void
  onOpenConversation: (user: User) => void
  onHideConversation: (user: User) => void
}

function displayName(user: User): string {
  return user.display_name?.trim() || user.username
}

function sortedConversations(conversations: User[]): User[] {
  return [...conversations].sort((left, right) => {
    if (left.last_message_at && right.last_message_at) {
      return new Date(right.last_message_at).getTime() - new Date(left.last_message_at).getTime()
    }
    if (left.last_message_at) return -1
    if (right.last_message_at) return 1
    return displayName(left).localeCompare(displayName(right), 'ru')
  })
}

export function HomeConversationSidebar({
  conversations,
  pendingCount,
  selectedUserId,
  hidingUserId,
  onOpenFriends,
  onOpenConversation,
  onHideConversation,
}: HomeConversationSidebarProps) {
  const [query, setQuery] = useState('')
  const visibleConversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru')
    const sorted = sortedConversations(conversations)
    if (!normalized) return sorted
    return sorted.filter((contact) => (
      displayName(contact).toLocaleLowerCase('ru').includes(normalized)
      || contact.username.toLocaleLowerCase('ru').includes(normalized)
    ))
  }, [conversations, query])

  return (
    <aside className="app-sidebar home-conversation-sidebar flex h-full flex-col border-r">
      <div className="home-conversation-sidebar__top">
        <label className="home-conversation-sidebar__search">
          <span className="sr-only">Найти беседу</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти или начать беседу"
          />
          <Search aria-hidden="true" />
        </label>
        <button
          type="button"
          className={`home-conversation-sidebar__friends ${selectedUserId == null ? 'is-active' : ''}`}
          onClick={onOpenFriends}
        >
          <Users aria-hidden="true" />
          <span>Друзья</span>
          {pendingCount > 0 && (
            <span className="home-conversation-sidebar__badge" aria-label={`Ожидающих запросов: ${pendingCount}`}>
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          )}
        </button>
      </div>

      <div className="home-conversation-sidebar__scroll">
        <h2 className="home-conversation-sidebar__heading">
          Личные сообщения — {visibleConversations.length}
        </h2>
        <div className="home-conversation-sidebar__list">
          {visibleConversations.map((contact) => {
            const name = displayName(contact)
            const selected = selectedUserId === contact.id
            const hiding = hidingUserId === contact.id
            return (
              <div
                key={contact.id}
                className={`home-conversation-row group ${selected ? 'is-active' : ''}`}
              >
                <button
                  type="button"
                  className="home-conversation-row__open"
                  onClick={() => onOpenConversation(contact)}
                  aria-label={`Открыть переписку с ${name}`}
                >
                  <UserAvatar user={contact} />
                  <span className="home-conversation-row__identity">
                    <span className="home-conversation-row__name">{name}</span>
                    <span className={contact.is_online ? 'is-online' : ''}>
                      {contact.is_online ? 'В сети' : 'Не в сети'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="home-conversation-row__hide"
                  onClick={() => onHideConversation(contact)}
                  disabled={hiding}
                  aria-label={`Скрыть диалог с ${name}`}
                  title="Скрыть диалог"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
