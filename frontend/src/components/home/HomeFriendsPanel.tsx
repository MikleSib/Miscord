'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, MessageCircle, Search, UserPlus, Users, X } from 'lucide-react'

import type { User } from '../../types'
import { UserAvatar } from '../ui/user-avatar'

export type FriendsTab = 'online' | 'all' | 'pending'

interface HomeFriendsPanelProps {
  activeTab: FriendsTab
  friends: User[]
  pendingRequests: any[]
  selectedUserId?: number
  onTabChange: (tab: FriendsTab) => void
  onAddFriend: () => void
  onOpenConversation: (user: User) => void
  onAcceptRequest: (requestId: number) => void
  onRejectRequest: (requestId: number) => void
}

function nameOf(user: User): string {
  return user.display_name?.trim() || user.username
}

function requestUser(request: any): User {
  return request?.from_user ?? request
}

export function HomeFriendsPanel({
  activeTab,
  friends,
  pendingRequests,
  selectedUserId,
  onTabChange,
  onAddFriend,
  onOpenConversation,
  onAcceptRequest,
  onRejectRequest,
}: HomeFriendsPanelProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('ru')
  const onlineFriends = useMemo(() => friends.filter((friend) => friend.is_online), [friends])
  const visibleFriends = useMemo(() => {
    const source = activeTab === 'online' ? onlineFriends : friends
    if (!normalizedQuery) return source
    return source.filter((friend) => (
      nameOf(friend).toLocaleLowerCase('ru').includes(normalizedQuery)
      || friend.username.toLocaleLowerCase('ru').includes(normalizedQuery)
    ))
  }, [activeTab, friends, normalizedQuery, onlineFriends])

  const count = activeTab === 'pending' ? pendingRequests.length : visibleFriends.length
  const countLabel = activeTab === 'online' ? 'В сети' : activeTab === 'all' ? 'Все друзья' : 'Ожидание'

  return (
    <section className="home-friends-detail">
      <header className="home-friends-toolbar">
        <div className="home-friends-toolbar__title">
          <Users aria-hidden="true" />
          <h2>Друзья</h2>
        </div>
        <span className="home-friends-toolbar__divider" aria-hidden="true" />
        <nav className="home-friends-tabs" aria-label="Разделы друзей">
          <button type="button" aria-pressed={activeTab === 'online'} onClick={() => onTabChange('online')} className={`home-friends-tab ${activeTab === 'online' ? 'is-active' : ''}`}>В сети</button>
          <button type="button" aria-pressed={activeTab === 'all'} onClick={() => onTabChange('all')} className={`home-friends-tab ${activeTab === 'all' ? 'is-active' : ''}`}>Все</button>
          <button type="button" aria-pressed={activeTab === 'pending'} onClick={() => onTabChange('pending')} className={`home-friends-tab ${activeTab === 'pending' ? 'is-active' : ''}`}>
            Ожидание
            {pendingRequests.length > 0 && <span className="home-friends-tab__badge">{pendingRequests.length}</span>}
          </button>
          <button type="button" onClick={onAddFriend} className="home-friends-tab home-friends-tab--add">Добавить в друзья</button>
        </nav>
      </header>

      <div className="home-friends-workspace">
        <main className="home-friends-center">
          {activeTab !== 'pending' && (
            <label className="home-friends-search">
              <span className="sr-only">Поиск друзей</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
              <Search aria-hidden="true" />
            </label>
          )}

          <div className="home-friends-list">
            <h3 className="home-dm-heading">{countLabel} — {count}</h3>
            {activeTab === 'pending' ? (
              <PendingList
                requests={pendingRequests}
                onAccept={onAcceptRequest}
                onReject={onRejectRequest}
              />
            ) : visibleFriends.length > 0 ? (
              visibleFriends.map((friend) => (
                <FriendRow
                  key={friend.id}
                  friend={friend}
                  selected={selectedUserId === friend.id}
                  onOpen={() => onOpenConversation(friend)}
                />
              ))
            ) : (
              <EmptyFriends online={activeTab === 'online'} filtered={Boolean(normalizedQuery)} />
            )}
          </div>
        </main>

        <aside className="home-active-contacts" aria-label="Активные контакты">
          <h2>Активные контакты</h2>
          {onlineFriends.length > 0 ? (
            <div className="home-active-contacts__list">
              {onlineFriends.map((friend) => (
                <button key={friend.id} type="button" onClick={() => onOpenConversation(friend)} className="home-active-contact">
                  <UserAvatar user={friend} size={36} />
                  <span>
                    <strong>{nameOf(friend)}</strong>
                    <small>В сети</small>
                  </span>
                  <span className="home-presence-dot" aria-label="В сети" />
                </button>
              ))}
            </div>
          ) : (
            <div className="home-active-contacts__empty">
              <UserPlus aria-hidden="true" />
              <strong>Пока тихо</strong>
              <p>Когда друзья будут в сети, они появятся здесь.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function FriendRow({ friend, selected, onOpen }: { friend: User; selected: boolean; onOpen: () => void }) {
  const name = nameOf(friend)
  const copyLogin = () => void navigator.clipboard?.writeText(`@${friend.username}`)
  return (
    <div className={`home-friend-row ${selected ? 'is-active' : ''}`}>
      <button type="button" className="home-friend-row__identity" onClick={onOpen} aria-label={`Открыть переписку с ${name}`}>
        <span className="home-friend-avatar"><UserAvatar user={friend} size={36} />{friend.is_online && <span className="home-presence-dot" />}</span>
        <span className="home-friend-row__copy"><strong>{name}</strong><small>{friend.is_online ? 'В сети' : 'Не в сети'}</small></span>
      </button>
      <div className="home-friend-row__actions">
        <button type="button" onClick={onOpen} aria-label={`Написать ${name}`} title="Написать"><MessageCircle aria-hidden="true" /></button>
        <button type="button" onClick={copyLogin} aria-label={`Скопировать логин ${friend.username}`} title="Скопировать логин"><Copy aria-hidden="true" /></button>
      </div>
    </div>
  )
}

function PendingList({ requests, onAccept, onReject }: { requests: any[]; onAccept: (id: number) => void; onReject: (id: number) => void }) {
  if (requests.length === 0) return <EmptyFriends pending />
  return <>{requests.filter(Boolean).map((request) => {
    const user = requestUser(request)
    const requestId = request.request_id ?? request.id
    return (
      <div key={requestId} className="home-friend-row">
        <div className="home-friend-row__identity"><UserAvatar user={user} size={36} /><span className="home-friend-row__copy"><strong>{nameOf(user)}</strong><small>Входящий запрос в друзья</small></span></div>
        <div className="home-friend-row__actions">
          <button type="button" onClick={() => onAccept(requestId)} className="is-accept" aria-label={`Принять запрос от ${nameOf(user)}`}><Check aria-hidden="true" /></button>
          <button type="button" onClick={() => onReject(requestId)} className="is-reject" aria-label={`Отклонить запрос от ${nameOf(user)}`}><X aria-hidden="true" /></button>
        </div>
      </div>
    )
  })}</>
}

function EmptyFriends({ online = false, filtered = false, pending = false }: { online?: boolean; filtered?: boolean; pending?: boolean }) {
  const title = filtered ? 'Ничего не найдено' : pending ? 'Нет ожидающих запросов' : online ? 'Сейчас никого нет в сети' : 'Здесь пока никого нет'
  const description = filtered ? 'Попробуйте изменить запрос.' : pending ? 'Новые запросы появятся здесь.' : 'Добавьте друга или начните новый диалог.'
  return <div className="home-friends-empty" role="status"><Users aria-hidden="true" /><p className="home-friends-empty__title">{title}</p><p className="home-friends-empty__description">{description}</p></div>
}
