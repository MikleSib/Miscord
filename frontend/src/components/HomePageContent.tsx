'use client'

import { useState, useEffect, useMemo } from 'react'
import { Users, MessageSquare, Settings, Check, X } from 'lucide-react'
import { User, FriendRequest } from '../types'
import friendService from '../services/friendService'
import directMessageService from '../services/directMessageService'
import websocketService from '../services/websocketService'
import { DirectMessageArea } from './DirectMessageArea'
import { UserAvatar } from './ui/user-avatar'
import authService from '../services/authService'
import { consumePendingDirectMessage } from '../lib/dmNavigation'
import { useDmNotificationStore } from '../store/dmNotificationStore'
import { Modal } from './ui/modal'

type Tab = 'online' | 'all' | 'pending' | 'blocked'

function getDisplayName(user: User): string {
  return user.display_name?.trim() || user.username
}

function mergeSidebarContacts(friends: User[], dmConversations: User[]): User[] {
  const byId = new Map<number, User>()

  for (const friend of friends) {
    byId.set(friend.id, { ...friend, is_friend: true })
  }

  for (const contact of dmConversations) {
    const existing = byId.get(contact.id)
    if (existing) {
      byId.set(contact.id, {
        ...existing,
        ...contact,
        is_friend: true,
        last_message_at: contact.last_message_at ?? existing.last_message_at,
      })
    } else {
      byId.set(contact.id, { ...contact, is_friend: false })
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const aHasMessage = Boolean(a.last_message_at)
    const bHasMessage = Boolean(b.last_message_at)

    if (aHasMessage && bHasMessage) {
      return new Date(b.last_message_at!).getTime() - new Date(a.last_message_at!).getTime()
    }
    if (aHasMessage !== bHasMessage) {
      return aHasMessage ? -1 : 1
    }

    if (a.is_online && !b.is_online) return -1
    if (!a.is_online && b.is_online) return 1
    return getDisplayName(a).localeCompare(getDisplayName(b), 'ru')
  })
}

export function HomePageContent() {
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [friends, setFriends] = useState<User[]>([])
  const [dmConversations, setDmConversations] = useState<User[]>([])
  const [pendingRequests, setPendingRequests] = useState<any[]>([])
  const [isAddFriendModalOpen, setIsAddFriendModalOpen] = useState(false)
  const [friendUsername, setFriendUsername] = useState('')
  const [addFriendError, setAddFriendError] = useState('')
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null)
  const [initialMessage, setInitialMessage] = useState<string | null>(null)
  
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const setActiveDmView = useDmNotificationStore((state) => state.setActiveView);
  const markDmViewed = useDmNotificationStore((state) => state.markViewed);


  const sidebarContacts = useMemo(
    () => mergeSidebarContacts(friends, dmConversations),
    [friends, dmConversations]
  )

  const onlineContacts = useMemo(
    () => sidebarContacts.filter((contact) => contact.is_online),
    [sidebarContacts]
  )

  useEffect(() => {
    const getcurrentUser = async () => {
      const user = await authService.getCurrentUser()
      setCurrentUser(user)
    }

    getcurrentUser()
  }, [])

  useEffect(() => {
    const openPendingDirectMessage = () => {
      const pending = consumePendingDirectMessage()
      if (!pending) return

      setSelectedFriend(pending.user)
      setInitialMessage(pending.message ?? null)
      markDmViewed(pending.user.id)
      setFriends((prev) =>
        prev.some((friend) => friend.id === pending.user.id) ? prev : [...prev, pending.user]
      )
      setDmConversations((prev) =>
        prev.some((contact) => contact.id === pending.user.id) ? prev : [...prev, pending.user]
      )
    }

    openPendingDirectMessage()
    window.addEventListener('open_direct_message', openPendingDirectMessage)

    return () => {
      window.removeEventListener('open_direct_message', openPendingDirectMessage)
    }
  }, [markDmViewed])

  useEffect(() => {
    setActiveDmView(selectedFriend?.id ?? null)
    window.dispatchEvent(new CustomEvent('miscord:dm-opened', { detail: { open: Boolean(selectedFriend) } }))
  }, [selectedFriend?.id, setActiveDmView])


  useEffect(() => {
    const fetchData = async () => {
      try {
        const [friendsData, pendingRequestsData, conversationsData] = await Promise.all([
          friendService.getFriends(),
          friendService.getPendingRequests(),
          directMessageService.getConversations(),
        ])
        setFriends(friendsData)
        setPendingRequests(pendingRequestsData)
        setDmConversations(conversationsData)
      } catch (error) {
        console.error('Ошибка загрузки данных о друзьях:', error)
      }
    }
    fetchData()

    const handleIncomingDm = (payload: { data?: { sender_id?: number; recipient_id?: number; timestamp?: string; author?: User } }) => {
      const message = payload?.data
      if (!message?.timestamp) return

      const peerId = message.sender_id === currentUser?.id ? message.recipient_id : message.sender_id
      if (!peerId) return

      const peerFromAuthor = message.author && message.author.id === peerId ? message.author : null

      const upsertContact = (prev: User[]) => {
        const existing = prev.find((contact) => contact.id === peerId)
        if (existing) {
          return prev.map((contact) =>
            contact.id === peerId
              ? { ...contact, last_message_at: message.timestamp, is_online: peerFromAuthor?.is_online ?? contact.is_online }
              : contact
          )
        }

        if (peerFromAuthor) {
          return [{ ...peerFromAuthor, last_message_at: message.timestamp }, ...prev]
        }

        return prev
      }

      setDmConversations(upsertContact)
      setFriends((prev) =>
        prev.map((friend) =>
          friend.id === peerId ? { ...friend, last_message_at: message.timestamp } : friend
        )
      )
    }

    const handleNewFriendRequest = (raw: any) => {
      const newRequest = raw?.data || raw;
      if (!newRequest?.id && !newRequest?.request_id) return;
      setPendingRequests((prev) => {
        const requestId = newRequest.request_id ?? newRequest.id;
        if (prev.some((req) => (req.request_id ?? req.id) === requestId)) {
          return prev;
        }
        return [newRequest, ...prev];
      });
    };

    const handleFriendRequestAccepted = (raw: any) => {
      const payload = raw?.data || raw;
      const user = payload?.user || payload;
      const requestId = payload?.request_id;
      if (!user?.id) return;

      setFriends((prev) => {
        if (prev.some((friend) => friend.id === user.id)) {
          return prev;
        }
        return [...prev, user];
      });
      if (requestId != null) {
        setPendingRequests((prev) => prev.filter((req) => req.request_id !== requestId));
      }
    };

    const handleFriendRequestRejected = (raw: any) => {
      const payload = raw?.data || raw;
      const requestId = payload?.request_id;
      if (requestId == null) return;
      setPendingRequests((prev) => prev.filter((req) => req.request_id !== requestId));
    };

    const handleFriendRemoved = (raw: any) => {
      const payload = raw?.data || raw;
      const friendId = payload?.friend_id;
      if (friendId == null) return;
      setFriends((prev) => prev.filter((f) => f.id !== friendId));
    };

    const handleUserProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const data = detail.data || detail;
      if (!data?.user_id) return;

      setFriends((prev) =>
        prev.map((friend) =>
          friend.id === data.user_id
            ? {
                ...friend,
                username: data.username ?? friend.username,
                display_name: data.display_name !== undefined ? data.display_name ?? undefined : friend.display_name,
                avatar_url: data.avatar_url !== undefined ? data.avatar_url ?? undefined : friend.avatar_url,
              }
            : friend
        )
      );

      setDmConversations((prev) =>
        prev.map((contact) =>
          contact.id === data.user_id
            ? {
                ...contact,
                username: data.username ?? contact.username,
                display_name: data.display_name !== undefined ? data.display_name ?? undefined : contact.display_name,
                avatar_url: data.avatar_url !== undefined ? data.avatar_url ?? undefined : contact.avatar_url,
              }
            : contact
        )
      );

      setSelectedFriend((prev) => {
        if (!prev || prev.id !== data.user_id) return prev;
        return {
          ...prev,
          username: data.username ?? prev.username,
          display_name: data.display_name !== undefined ? data.display_name ?? undefined : prev.display_name,
          avatar_url: data.avatar_url !== undefined ? data.avatar_url ?? undefined : prev.avatar_url,
        };
      });

      setPendingRequests((prev) =>
        prev.map((req) => {
          const target = req.from_user || req;
          if (target.id !== data.user_id) return req;
          if (req.from_user) {
            return {
              ...req,
              from_user: {
                ...req.from_user,
                username: data.username ?? req.from_user.username,
                display_name:
                  data.display_name !== undefined
                    ? data.display_name ?? undefined
                    : req.from_user.display_name,
                avatar_url:
                  data.avatar_url !== undefined
                    ? data.avatar_url ?? undefined
                    : req.from_user.avatar_url,
              },
            };
          }
          return {
            ...req,
            username: data.username ?? req.username,
            display_name: data.display_name !== undefined ? data.display_name ?? undefined : req.display_name,
            avatar_url: data.avatar_url !== undefined ? data.avatar_url ?? undefined : req.avatar_url,
          };
        })
      );
    };

    websocketService.on('new_friend_request', handleNewFriendRequest);
    websocketService.on('friend_request_accepted', handleFriendRequestAccepted);
    websocketService.on('friend_request_rejected', handleFriendRequestRejected);
    websocketService.on('friend_removed', handleFriendRemoved);
    websocketService.on('dm', handleIncomingDm);
    window.addEventListener('user_profile_updated', handleUserProfileUpdated);
    
    return () => {
      websocketService.off('new_friend_request', handleNewFriendRequest);
      websocketService.off('friend_request_accepted', handleFriendRequestAccepted);
      websocketService.off('friend_request_rejected', handleFriendRequestRejected);
      websocketService.off('friend_removed', handleFriendRemoved);
      websocketService.off('dm', handleIncomingDm);
      window.removeEventListener('user_profile_updated', handleUserProfileUpdated);
    }
  }, [currentUser?.id])

  const handleAddFriend = async () => {
    if (!friendUsername.trim()) return
    setAddFriendError('')
    try {
      await friendService.sendFriendRequest(friendUsername)
      setFriendUsername('')
      setIsAddFriendModalOpen(false)
      // TODO: Показать пользователю уведомление об успехе
    } catch (error: any) {
      console.error('Ошибка добавления в друзья:', error)
      setAddFriendError(error.response?.data?.detail || 'Не удалось отправить запрос')
    }
  }

  const handleAcceptRequest = async (requestId: number) => {
    const requestToAccept = pendingRequests.find(req => req.request_id === requestId);
    if (!requestToAccept) return;

    const previousFriends = friends;
    const previousPending = pendingRequests;
    // Optimistic update
    setFriends(prevFriends => [...prevFriends, requestToAccept as User]);
    setPendingRequests(prev => prev.filter(req => req.request_id !== requestId));

    try {
      await friendService.acceptFriendRequest(requestId);
    } catch (error) {
      console.error('Ошибка принятия запроса:', error);
      setFriends(previousFriends);
      setPendingRequests(previousPending);
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    try {
      await friendService.rejectFriendRequest(requestId);
      setPendingRequests(prev => prev.filter(req => req.request_id !== requestId));
    } catch (error) {
      console.error('Ошибка отклонения запроса:', error);
    }
  };


  const openContactChat = (contact: User) => {
    markDmViewed(contact.id)
    setSelectedFriend(contact)
  }

  const renderContactRow = (contact: User) => (
    <div key={contact.id} onClick={() => openContactChat(contact)} className="flex items-center justify-between p-2 hover:bg-gray-800 rounded-md cursor-pointer">
      <div className="flex items-center">
        <UserAvatar user={contact} />
        <div className="ml-3">
          <p className="text-white">{getDisplayName(contact)}</p>
          <p className={`text-xs ${contact.is_online ? 'text-green-400' : 'text-text-quiet'}`}>
            {contact.is_online ? 'В сети' : contact.is_friend === false ? 'Личные сообщения' : 'Не в сети'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button 
          onClick={(e) => { 
            e.stopPropagation(); 
            openContactChat(contact); 
          }} 
          className="p-1 text-text-quiet hover:text-white"
        >
          <MessageSquare size={20} />
        </button>
      </div>
    </div>
  )

  const renderContent = () => {
    switch (activeTab) {
      case 'online':
        return (
          <div className="home-friends-section">
            <h3 className="home-dm-heading text-xs font-bold uppercase text-text-quiet mb-2">
              В сети — {onlineContacts.length}
            </h3>
            {onlineContacts.length > 0 ? (
              onlineContacts.map(renderContactRow)
            ) : (
              <div className="home-friends-empty text-center text-muted-foreground" role="status">
                <Users aria-hidden="true" />
                <p className="home-friends-empty__title">Сейчас никого нет в сети</p>
                <p className="home-friends-empty__description">Загляните сюда позже или начните новый диалог.</p>
              </div>
            )}
          </div>
        )
      case 'all':
        return (
          <div className="home-friends-section">
            <h3 className="home-dm-heading text-xs font-bold uppercase text-text-quiet mb-2">
              Личные сообщения — {sidebarContacts.length}
            </h3>
            {sidebarContacts.length > 0 ? (
              sidebarContacts.map(renderContactRow)
            ) : (
              <div className="home-friends-empty text-center text-muted-foreground" role="status">
                <Users aria-hidden="true" />
                <p className="home-friends-empty__title">Здесь пока никого нет</p>
                <p className="home-friends-empty__description">Добавьте друга или начните новый диалог.</p>
              </div>
            )}
          </div>
        )
      case 'pending':
        return (
          <div className="home-friends-section">
            <h3 className="home-dm-heading text-xs font-bold uppercase text-text-quiet mb-2">
              Входящие — {pendingRequests.length}
            </h3>
            {pendingRequests.length > 0 ? (
               pendingRequests.filter(Boolean).map(request => (
                <div key={request.request_id} className="flex items-center justify-between p-2 hover:bg-gray-800 rounded-md">
                  <div className="flex items-center">
                    <UserAvatar user={request} />
                    <div className="ml-3">
                      <p className="text-white">{request.username}</p>
                      <p className="text-xs text-text-quiet">Входящий запрос в друзья</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleAcceptRequest(request.request_id!)} className="w-9 h-9 flex items-center justify-center bg-gray-700 hover:bg-green-600 rounded-full text-white">
                      <Check size={20} />
                    </button>
                    <button onClick={() => handleRejectRequest(request.request_id!)} className="w-9 h-9 flex items-center justify-center bg-gray-700 hover:bg-red-600 rounded-full text-white">
                      <X size={20} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="home-friends-empty text-center text-muted-foreground" role="status">
                <Users aria-hidden="true" />
                <p className="home-friends-empty__title">Нет ожидающих запросов</p>
                <p className="home-friends-empty__description">Новые запросы в друзья появятся здесь.</p>
              </div>
            )}
          </div>
        )
      default:
        return <p className="text-center text-text-quiet mt-20">Контент для "{activeTab}" еще не реализован.</p>
    }
  }

  return (
    <div className="app-home-content flex flex-1 h-full min-w-0">
      {/* Friends List and Controls Sidebar */}
      <div className="app-sidebar flex h-full flex-col border-r">
        {/* Top bar for friends page */}
        <div className="home-friends-header flex h-12 flex-shrink-0 items-center border-b border-border px-4">
          <div className="flex items-center">
            <Users className="w-6 h-6 text-text-quiet mr-2" />
            <h2 className="text-white font-semibold">Друзья</h2>
          </div>
        </div>
        <nav className="home-friends-tabs flex items-center p-2" aria-label="Разделы друзей">
          <button aria-pressed={activeTab === 'all'} onClick={() => setActiveTab('all')} className={`home-friends-tab ${activeTab === 'all' ? 'is-active' : ''}`}>Все</button>
          <div className="relative">
            <button aria-pressed={activeTab === 'pending'} onClick={() => setActiveTab('pending')} className={`home-friends-tab ${activeTab === 'pending' ? 'is-active' : ''}`}>Ожидание</button>
            {pendingRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center font-bold">
                {pendingRequests.length}
              </span>
            )}
          </div>
         
          <button onClick={() => setIsAddFriendModalOpen(true)} className="home-friends-tab home-friends-tab--add">Добавить</button>
        </nav>
        <div className="home-friends-list flex-1 overflow-y-auto p-2">
          {renderContent()}
        </div>
      </div>

      {/* Main content area */}
      <div className="app-home-detail flex h-full min-w-0 flex-1 flex-col bg-[#323339]">
        {selectedFriend ? (
          <DirectMessageArea
            friend={selectedFriend}
            initialMessage={initialMessage}
            onInitialMessageSent={() => setInitialMessage(null)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
             <h3 className="text-xl font-bold text-white mb-4">Выберите друга</h3>
             <p>Выберите друга из списка слева, чтобы начать переписку.</p>
          </div>
        )}
      </div>

      {/* Add Friend Modal */}
      <Modal
        open={isAddFriendModalOpen}
        onClose={() => setIsAddFriendModalOpen(false)}
        title="Добавить в друзья"
        contentClassName="add-friend-dialog bg-[#323339]"
      >
        <form
          className="add-friend-dialog__body p-6"
          onSubmit={(event) => {
            event.preventDefault()
            void handleAddFriend()
          }}
        >
          <header className="add-friend-dialog__header">
            <div>
              <h2 className="text-xl font-bold text-white">Добавить в друзья</h2>
              <p className="mt-2 text-sm leading-5 text-text-quiet">
                Введите логин пользователя (@username), а не отображаемое имя. Регистр букв не важен.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAddFriendModalOpen(false)}
              className="add-friend-dialog__close text-text-quiet"
              aria-label="Закрыть"
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <label className="mt-5 block">
            <span className="sr-only">Имя пользователя</span>
            <input
              type="text"
              value={friendUsername}
              onChange={(event) => setFriendUsername(event.target.value)}
              placeholder="Например: sava или @sava"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-11 w-full rounded-md border border-gray-700 bg-canvas-deep px-3 text-white outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          {addFriendError && <p className="mt-3 text-sm text-red-400" role="alert">{addFriendError}</p>}
          <div className="add-friend-dialog__actions mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setIsAddFriendModalOpen(false)} className="rounded-md px-4 py-2 text-white">Отмена</button>
            <button type="submit" className="rounded-md bg-primary px-4 py-2 font-semibold text-white">Отправить запрос</button>
          </div>
        </form>
      </Modal>
      
    </div>
  )
}
