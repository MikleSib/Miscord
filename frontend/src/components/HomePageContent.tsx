'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { User } from '../types'
import friendService from '../services/friendService'
import directMessageService from '../services/directMessageService'
import websocketService from '../services/websocketService'
import { DirectMessageArea } from './DirectMessageArea'
import { consumePendingDirectMessage } from '../lib/dmNavigation'
import { useDmNotificationStore } from '../store/dmNotificationStore'
import { Modal } from './ui/modal'
import { SecretDirectMessageArea } from './SecretDirectMessageArea'
import { useAuthStore } from '../store/store'
import { useHomeNavigationData } from '../hooks/useHomeNavigationData'
import { HomeConversationSidebar } from './home/HomeConversationSidebar'
import { HomeFriendsPanel, type FriendsTab } from './home/HomeFriendsPanel'

export function HomePageContent() {
  const [activeTab, setActiveTab] = useState<FriendsTab>('online')
  const [isAddFriendModalOpen, setIsAddFriendModalOpen] = useState(false)
  const [friendUsername, setFriendUsername] = useState('')
  const [addFriendError, setAddFriendError] = useState('')
  const [initialMessage, setInitialMessage] = useState<string | null>(null)
  const [secretMode, setSecretMode] = useState(false)
  const [friendsPanelOpen, setFriendsPanelOpen] = useState(false)
  const [hidingConversationId, setHidingConversationId] = useState<number>()
  const currentUser = useAuthStore((state) => state.user)
  const {
    friends,
    dmConversations,
    pendingRequests,
    selectedFriend,
    setFriends,
    setDmConversations,
    setPendingRequests,
    setSelectedFriend,
  } = useHomeNavigationData(currentUser?.id)
  const setActiveDmView = useDmNotificationStore((state) => state.setActiveView);
  const markDmViewed = useDmNotificationStore((state) => state.markViewed);


  useEffect(() => { setSecretMode(false) }, [selectedFriend?.id])

  useEffect(() => {
    const openPendingDirectMessage = () => {
      const pending = consumePendingDirectMessage()
      if (!pending) return

      setFriendsPanelOpen(false)
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
  }, [markDmViewed, setDmConversations, setFriends, setSelectedFriend])

  useEffect(() => {
    setActiveDmView(selectedFriend?.id ?? null)
    window.dispatchEvent(new CustomEvent('miscord:dm-opened', {
      detail: { open: Boolean(selectedFriend) || friendsPanelOpen },
    }))
  }, [friendsPanelOpen, selectedFriend?.id, setActiveDmView])


  useEffect(() => {
    const handleIncomingDm = (payload: { data?: { sender_id?: number; recipient_id?: number; timestamp?: string; author?: User } }) => {
      const message = payload?.data
      if (!message?.timestamp) return

      const peerId = message.sender_id === currentUser?.id ? message.recipient_id : message.sender_id
      if (!peerId) return

      const peerFromAuthor = message.author && message.author.id === peerId ? message.author : null
      const peer = peerFromAuthor ?? friends.find((friend) => friend.id === peerId)

      const upsertContact = (prev: User[]) => {
        const existing = prev.find((contact) => contact.id === peerId)
        if (existing) {
          return prev.map((contact) =>
            contact.id === peerId
              ? { ...contact, last_message_at: message.timestamp, is_online: peerFromAuthor?.is_online ?? contact.is_online }
              : contact
          )
        }

        if (peer) {
          return [{ ...peer, last_message_at: message.timestamp }, ...prev]
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
  }, [
    currentUser?.id,
    friends,
    setDmConversations,
    setFriends,
    setPendingRequests,
    setSelectedFriend,
  ])

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
    setFriendsPanelOpen(false)
    markDmViewed(contact.id)
    setSelectedFriend(contact)
  }

  const openFriends = () => {
    setFriendsPanelOpen(true)
    setSelectedFriend(null)
    window.dispatchEvent(new CustomEvent('miscord:dm-opened', { detail: { open: true } }))
  }

  const hideConversation = async (contact: User) => {
    if (hidingConversationId != null) return
    const wasSelected = selectedFriend?.id === contact.id
    setHidingConversationId(contact.id)
    setDmConversations((conversations) => conversations.filter((item) => item.id !== contact.id))
    if (wasSelected) {
      setFriendsPanelOpen(false)
      setSelectedFriend(null)
    }

    try {
      await directMessageService.hideConversation(contact.id)
    } catch (error) {
      console.error('Не удалось скрыть диалог:', error)
      setDmConversations((conversations) => (
        conversations.some((item) => item.id === contact.id) ? conversations : [contact, ...conversations]
      ))
      if (wasSelected) setSelectedFriend((current) => current ?? contact)
    } finally {
      setHidingConversationId(undefined)
    }
  }

  return (
    <div className="app-home-content flex flex-1 h-full min-w-0">
      <HomeConversationSidebar
        conversations={dmConversations}
        pendingCount={pendingRequests.length}
        selectedUserId={selectedFriend?.id}
        hidingUserId={hidingConversationId}
        onOpenFriends={openFriends}
        onOpenConversation={openContactChat}
        onHideConversation={(contact) => void hideConversation(contact)}
      />

      <div className="app-home-detail flex h-full min-w-0 flex-1 flex-col bg-[#323339]">
        {selectedFriend && secretMode ? (
          <SecretDirectMessageArea key={selectedFriend.id} friend={selectedFriend} onClose={() => setSecretMode(false)} />
        ) : selectedFriend ? (
          <DirectMessageArea
            key={selectedFriend.id}
            friend={selectedFriend}
            initialMessage={initialMessage}
            onInitialMessageSent={() => setInitialMessage(null)}
            onOpenSecret={() => setSecretMode(true)}
          />
        ) : (
          <HomeFriendsPanel
            activeTab={activeTab}
            friends={friends}
            pendingRequests={pendingRequests}
            onTabChange={setActiveTab}
            onAddFriend={() => setIsAddFriendModalOpen(true)}
            onOpenConversation={openContactChat}
            onAcceptRequest={(requestId) => void handleAcceptRequest(requestId)}
            onRejectRequest={(requestId) => void handleRejectRequest(requestId)}
          />
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
