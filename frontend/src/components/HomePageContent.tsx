'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Users, MessageSquare, Settings, Check, X, Phone } from 'lucide-react'
import { User, FriendRequest } from '../types'
import friendService from '../services/friendService'
import directMessageService from '../services/directMessageService'
import websocketService from '../services/websocketService'
import { DirectMessageArea } from './DirectMessageArea'
import { UserAvatar } from './ui/user-avatar'
import { VoiceOverlay } from './VoiceOverlay'
import p2pVoiceService from '../services/p2pVoiceService'
import P2PCallUI from './P2PCallUI'
import P2POutgoingCallUI from './P2POutgoingCallUI'
import soundService from '../services/soundService'
import authService from '../services/authService'
import { consumePendingDirectMessage } from '../lib/dmNavigation'
import { useDmNotificationStore } from '../store/dmNotificationStore'

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
  
  const [currentCall, setCurrentCall] = useState<any>(null);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isOutgoingCall, setIsOutgoingCall] = useState(false);
  const [caller, setCaller] = useState<User | null>(null);
  const [callee, setCallee] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [inCall, setInCall] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
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

  const handleCallEnded = () => {
    setCurrentCall(null);
    setIsIncomingCall(false);
    setIsOutgoingCall(false);
    setCaller(null);
    setCallee(null);
    setInCall(false);
    setRemoteStream(null);
    soundService.stopAllSounds();
  };
  
  // Регистрация WebSocket обработчиков P2P происходит в конструкторе p2pVoiceService
  // Не нужно регистрировать их снова здесь, чтобы избежать дублирования

  useEffect(() => {
    const handleIncomingCall = (event: any) => {
      const incomingCaller = event.detail;
      console.log('[HomePageContent] handleIncomingCall:', { incomingCaller, currentUser });
      if (!currentUser) return;
      setCaller(incomingCaller);
      setCallee(currentUser);
      setIsIncomingCall(true);
      soundService.playIncomingCallSound();
      // Сохраняем информацию о звонящем для возможности отклонения
      p2pVoiceService.setCurrentCaller(incomingCaller);
    };

    const handleCallAccepted = (event: any) => {
      const { recipient } = event.detail;
      console.log('[HomePageContent] handleCallAccepted вызван:', { recipient, caller, currentUser, isOutgoingCall });
      setIsIncomingCall(false);
      setIsOutgoingCall(false);
      soundService.stopAllSounds();
      setInCall(true);
      // Инициатор звонка создает offer после подтверждения
      if (caller?.id === currentUser?.id) {
          p2pVoiceService.createOffer(recipient.id);
      }
      // Показываем уведомление звонящему, что звонок принят
      if (caller?.id === currentUser?.id) {
        console.log('Звонок принят получателем!');
      }
    };

    const handleAcceptCall = (data: { to: number; from: any }) => {
      console.log('[HomePageContent] handleAcceptCall вызван:', { data, caller, currentUser, isOutgoingCall });
      // Это сообщение приходит звонящему (инициатору), когда принимающий поднимает трубку
      if (currentUser && data.to === currentUser.id) {
        console.log('[HomePageContent] Звонящий получил подтверждение принятия звонка');
        setIsOutgoingCall(false);
        soundService.stopAllSounds();
        setInCall(true);
        // Инициатор создает offer для WebRTC соединения
        p2pVoiceService.createOffer(data.from.id);
      }
    };

    const handleCallDeclined = (event: any) => {
      console.log('[HomePageContent] handleCallDeclined вызван:', { caller, currentUser, isOutgoingCall });
      soundService.stopAllSounds();
      setIsOutgoingCall(false);
      setIsIncomingCall(false);
      // Показываем уведомление звонящему, что звонок отклонен
      if (caller?.id === currentUser?.id) {
        console.log('Звонок отклонен получателем!');
        // Для звонящего - завершаем звонок полностью
        handleCallEnded();
      }
    };

    const handleCallEndedEvent = (event: any) => {
      handleCallEnded();
    };

    const handleRemoteStream = (stream: MediaStream) => {
      console.log('[HomePageContent] Received remote stream:', stream);
      setRemoteStream(stream);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.play().catch(e => console.error('[HomePageContent] Error playing remote audio:', e));
      }
    };

    // Обработчики для WebSocket событий P2P звонков
    const handleP2PIncomingCall = (data: any) => {
      const event = new CustomEvent('p2p-incoming-call', { detail: data.caller });
      window.dispatchEvent(event);
    };

    const handleP2PCallAccepted = (data: any) => {
      const event = new CustomEvent('p2p-call-accepted', { detail: data });
      window.dispatchEvent(event);
    };

    const handleP2PCallDeclined = (data: any) => {
      const event = new CustomEvent('p2p-call-declined', { detail: data });
      window.dispatchEvent(event);
    };

    p2pVoiceService.on('remote_stream_received', handleRemoteStream);

    // Подписываемся на WebSocket события P2P звонков
    websocketService.onP2PIncomingCall(handleP2PIncomingCall);
    websocketService.onP2PCallAccepted(handleP2PCallAccepted);
    websocketService.onP2PCallDeclined(handleP2PCallDeclined);
    websocketService.onP2PAcceptCall(handleAcceptCall);

    // Слушаем глобальные события вместо прямых WebSocket обработчиков
    if (typeof window !== 'undefined') {
      window.addEventListener('p2p-incoming-call', handleIncomingCall);
      window.addEventListener('p2p-call-accepted', handleCallAccepted);
      window.addEventListener('p2p-call-declined', handleCallDeclined);
      window.addEventListener('p2p-call-ended', handleCallEndedEvent);
    }

    return () => {
      // Отписываемся от WebSocket событий
      websocketService.off('p2p-incoming-call', handleP2PIncomingCall);
      websocketService.off('p2p-call-accepted', handleP2PCallAccepted);
      websocketService.off('p2p-call-declined', handleP2PCallDeclined);
      websocketService.off('p2p-accept-call', handleAcceptCall);
      
      // Отписываемся от window событий при размонтировании
      if (typeof window !== 'undefined') {
        window.removeEventListener('p2p-incoming-call', handleIncomingCall);
        window.removeEventListener('p2p-call-accepted', handleCallAccepted);
        window.removeEventListener('p2p-call-declined', handleCallDeclined);
        window.removeEventListener('p2p-call-ended', handleCallEndedEvent);
      }
      p2pVoiceService.off('remote_stream_received', handleRemoteStream);
    };
  }, [currentUser, friends, callee]);
  
  // useEffect для обработки изменений remoteStream
  useEffect(() => {
    if (remoteStream && remoteAudioRef.current) {
      console.log('[HomePageContent] Setting remote stream to audio element');
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.volume = 1.0;
      remoteAudioRef.current.play().catch(e => console.error('[HomePageContent] Error playing remote audio in useEffect:', e));
    }
  }, [remoteStream]);

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

    const handleNewFriendRequest = (newRequest: User) => {
      setPendingRequests(prev => [newRequest, ...prev]);
    };

    const handleFriendRequestAccepted = ({ user, request_id }: { user: User, request_id: number }) => {
      setFriends(prev => {
        // Avoid adding duplicate if already present from optimistic update
        if (prev.some(friend => friend.id === user.id)) {
          return prev;
        }
        return [...prev, user];
      });
      setPendingRequests(prev => prev.filter(req => req.request_id !== request_id));
    };

    const handleFriendRequestRejected = ({ request_id }: { request_id: number }) => {
      setPendingRequests(prev => prev.filter(req => req.request_id !== request_id));
    };

    const handleFriendRemoved = ({ friend_id }: { friend_id: number }) => {
      setFriends(prev => prev.filter(f => f.id !== friend_id));
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

    try {
      await friendService.acceptFriendRequest(requestId);
      // Optimistic update
      setFriends(prevFriends => [...prevFriends, requestToAccept as User]);
      setPendingRequests(prev => prev.filter(req => req.request_id !== requestId));
    } catch (error) {
      console.error('Ошибка принятия запроса:', error);
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

  const handleCallUser = (user: User) => {
    if (!currentUser) return;
    setCallee(user); // кого вызываем
    setCaller(currentUser); // кто вызывает
    setIsOutgoingCall(true);
    soundService.playCallingSound();
    p2pVoiceService.initiateCall(user.id);
  };
  
  const handleHangUp = () => {
    const peerId = caller?.id === currentUser?.id ? callee?.id : caller?.id;
    if (peerId) {
      p2pVoiceService.hangUp(peerId);
    }
    handleCallEnded();
  };

  const openContactChat = (contact: User) => {
    markDmViewed(contact.id)
    setSelectedFriend(contact)
  }

  const renderContactRow = (contact: User) => (
    <div key={contact.id} onClick={() => openContactChat(contact)} className="flex items-center justify-between p-2 hover:bg-[#393a3f] rounded-md cursor-pointer">
      <div className="flex items-center">
        <UserAvatar user={contact} />
        <div className="ml-3">
          <p className="text-white">{getDisplayName(contact)}</p>
          <p className={`text-xs ${contact.is_online ? 'text-green-400' : 'text-[#999aa1]'}`}>
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
          className="p-1 text-[#999aa1] hover:text-white"
        >
          <MessageSquare size={20} />
        </button>
        <button 
          onClick={(e) => { 
            e.stopPropagation(); 
            handleCallUser(contact); 
          }} 
          className="p-1 text-[#999aa1] hover:text-white"
        >
          <Phone size={20} />
        </button>
      </div>
    </div>
  )

  const renderContent = () => {
    switch (activeTab) {
      case 'online':
        return (
          <div className="home-friends-section">
            <h3 className="home-dm-heading text-xs font-bold uppercase text-[#999aa1] mb-2">
              В сети — {onlineContacts.length}
            </h3>
            {onlineContacts.length > 0 ? (
              onlineContacts.map(renderContactRow)
            ) : (
              <div className="home-friends-empty text-center text-[#b5bac1]" role="status">
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
            <h3 className="home-dm-heading text-xs font-bold uppercase text-[#999aa1] mb-2">
              Личные сообщения — {sidebarContacts.length}
            </h3>
            {sidebarContacts.length > 0 ? (
              sidebarContacts.map(renderContactRow)
            ) : (
              <div className="home-friends-empty text-center text-[#b5bac1]" role="status">
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
            <h3 className="home-dm-heading text-xs font-bold uppercase text-[#999aa1] mb-2">
              Входящие — {pendingRequests.length}
            </h3>
            {pendingRequests.length > 0 ? (
               pendingRequests.filter(Boolean).map(request => (
                <div key={request.request_id} className="flex items-center justify-between p-2 hover:bg-[#393a3f] rounded-md">
                  <div className="flex items-center">
                    <UserAvatar user={request} />
                    <div className="ml-3">
                      <p className="text-white">{request.username}</p>
                      <p className="text-xs text-[#999aa1]">Входящий запрос в друзья</p>
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
              <div className="home-friends-empty text-center text-[#b5bac1]" role="status">
                <Users aria-hidden="true" />
                <p className="home-friends-empty__title">Нет ожидающих запросов</p>
                <p className="home-friends-empty__description">Новые запросы в друзья появятся здесь.</p>
              </div>
            )}
          </div>
        )
      default:
        return <p className="text-center text-[#999aa1] mt-20">Контент для "{activeTab}" еще не реализован.</p>
    }
  }

  return (
    <div className="app-home-content flex flex-1 h-full min-w-0">
      {isIncomingCall && caller && currentUser && (
        <P2PCallUI
          caller={caller}
          callee={currentUser}
          onAccept={() => {
            if (caller) {
              soundService.stopAllSounds();
              setIsIncomingCall(false);
              p2pVoiceService.acceptCall(caller.id, caller);
              setInCall(true); // Сразу переходим в состояние звонка
            }
          }}
          onDecline={() => {
            console.log('[HomePageContent] onDecline called, caller:', caller);
            if(caller && caller.id) {
              console.log('[HomePageContent] Using caller from state:', caller.id);
              soundService.stopAllSounds();
              setIsIncomingCall(false);
              p2pVoiceService.declineCall(caller.id);
            } else {
              // Если caller не установлен, используем сохраненную информацию
              const savedCaller = p2pVoiceService.getCurrentCaller();
              console.log('[HomePageContent] Using saved caller:', savedCaller);
              if (savedCaller && savedCaller.id) {
                console.log('[HomePageContent] Using saved caller id:', savedCaller.id);
                soundService.stopAllSounds();
                setIsIncomingCall(false);
                p2pVoiceService.declineCall(savedCaller.id);
              } else {
                console.error('[HomePageContent] No caller information available for decline');
              }
            }
          }}
        />
      )}

      {isOutgoingCall && callee && (
        <P2POutgoingCallUI
          callee={callee}
          onCancel={() => {
            if (callee) {
              soundService.stopAllSounds();
              setIsOutgoingCall(false);
              p2pVoiceService.hangUp(callee.id);
            }
          }}
        />
      )}

      {inCall && callee && caller && (
      <VoiceOverlay
        onHangUp={handleHangUp}
        participantsList={[
          {
            user_id: caller.id,
            username: caller.username,
            display_name: caller.username,
            avatar_url: caller.avatar_url,
            is_muted: false, // Вам нужно будет управлять этим состоянием
            is_deafened: false,
          },
          {
            user_id: callee.id,
            username: callee.username,
            display_name: callee.username,
            avatar_url: callee.avatar_url,
            is_muted: false,
            is_deafened: false,
          },
        ]}
        channelName={`${caller.username} & ${callee.username}`}
        serverName="Приватный звонок"
      />
      )}



      {/* Friends List and Controls Sidebar */}
      <div className="app-sidebar flex h-full flex-col border-r">
        {/* Top bar for friends page */}
        <div className="home-friends-header flex h-12 flex-shrink-0 items-center border-b border-border px-4">
          <div className="flex items-center">
            <Users className="w-6 h-6 text-[#999aa1] mr-2" />
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
      {isAddFriendModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[#323339] p-6 rounded-lg w-96">
            <h2 className="text-xl font-bold text-white mb-4">Добавить в друзья</h2>
            <p className="text-[#999aa1] text-sm mb-4">
              Введите логин пользователя (@username), а не отображаемое имя. Регистр букв не важен.
            </p>
            <input
              type="text"
              value={friendUsername}
              onChange={(e) => setFriendUsername(e.target.value)}
              placeholder="Например: sava или @sava"
              className="w-full bg-[#1e1f22] text-white rounded px-3 py-2 mb-4 border border-[#393a41] focus:ring-2 focus:ring-[#5865f2]"
            />
            {addFriendError && <p className="text-red-500 text-sm mb-4">{addFriendError}</p>}
            <div className="flex justify-end">
              <button onClick={() => setIsAddFriendModalOpen(false)} className="text-white mr-4">Отмена</button>
              <button onClick={handleAddFriend} className="bg-[#5865f2] text-white px-4 py-2 rounded">Отправить запрос</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Скрытый audio элемент для воспроизведения входящего аудио из P2P звонков */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        style={{ display: 'none' }}
      />
    </div>
  )
}
