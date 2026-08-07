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
  
  // Р РµРіРёСЃС‚СЂР°С†РёСЏ WebSocket РѕР±СЂР°Р±РѕС‚С‡РёРєРѕРІ P2P РїСЂРѕРёСЃС…РѕРґРёС‚ РІ РєРѕРЅСЃС‚СЂСѓРєС‚РѕСЂРµ p2pVoiceService
  // РќРµ РЅСѓР¶РЅРѕ СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°С‚СЊ РёС… СЃРЅРѕРІР° Р·РґРµСЃСЊ, С‡С‚РѕР±С‹ РёР·Р±РµР¶Р°С‚СЊ РґСѓР±Р»РёСЂРѕРІР°РЅРёСЏ

  useEffect(() => {
    const handleIncomingCall = (event: any) => {
      const incomingCaller = event.detail;
      console.log('[HomePageContent] handleIncomingCall:', { incomingCaller, currentUser });
      if (!currentUser) return;
      setCaller(incomingCaller);
      setCallee(currentUser);
      setIsIncomingCall(true);
      soundService.playIncomingCallSound();
      // РЎРѕС…СЂР°РЅСЏРµРј РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ Р·РІРѕРЅСЏС‰РµРј РґР»СЏ РІРѕР·РјРѕР¶РЅРѕСЃС‚Рё РѕС‚РєР»РѕРЅРµРЅРёСЏ
      p2pVoiceService.setCurrentCaller(incomingCaller);
    };

    const handleCallAccepted = (event: any) => {
      const { recipient } = event.detail;
      console.log('[HomePageContent] handleCallAccepted РІС‹Р·РІР°РЅ:', { recipient, caller, currentUser, isOutgoingCall });
      setIsIncomingCall(false);
      setIsOutgoingCall(false);
      soundService.stopAllSounds();
      setInCall(true);
      // РРЅРёС†РёР°С‚РѕСЂ Р·РІРѕРЅРєР° СЃРѕР·РґР°РµС‚ offer РїРѕСЃР»Рµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ
      if (caller?.id === currentUser?.id) {
          p2pVoiceService.createOffer(recipient.id);
      }
      // РџРѕРєР°Р·С‹РІР°РµРј СѓРІРµРґРѕРјР»РµРЅРёРµ Р·РІРѕРЅСЏС‰РµРјСѓ, С‡С‚Рѕ Р·РІРѕРЅРѕРє РїСЂРёРЅСЏС‚
      if (caller?.id === currentUser?.id) {
        console.log('Р—РІРѕРЅРѕРє РїСЂРёРЅСЏС‚ РїРѕР»СѓС‡Р°С‚РµР»РµРј!');
      }
    };

    const handleAcceptCall = (data: { to: number; from: any }) => {
      console.log('[HomePageContent] handleAcceptCall РІС‹Р·РІР°РЅ:', { data, caller, currentUser, isOutgoingCall });
      // Р­С‚Рѕ СЃРѕРѕР±С‰РµРЅРёРµ РїСЂРёС…РѕРґРёС‚ Р·РІРѕРЅСЏС‰РµРјСѓ (РёРЅРёС†РёР°С‚РѕСЂСѓ), РєРѕРіРґР° РїСЂРёРЅРёРјР°СЋС‰РёР№ РїРѕРґРЅРёРјР°РµС‚ С‚СЂСѓР±РєСѓ
      if (currentUser && data.to === currentUser.id) {
        console.log('[HomePageContent] Р—РІРѕРЅСЏС‰РёР№ РїРѕР»СѓС‡РёР» РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ РїСЂРёРЅСЏС‚РёСЏ Р·РІРѕРЅРєР°');
        setIsOutgoingCall(false);
        soundService.stopAllSounds();
        setInCall(true);
        // РРЅРёС†РёР°С‚РѕСЂ СЃРѕР·РґР°РµС‚ offer РґР»СЏ WebRTC СЃРѕРµРґРёРЅРµРЅРёСЏ
        p2pVoiceService.createOffer(data.from.id);
      }
    };

    const handleCallDeclined = (event: any) => {
      console.log('[HomePageContent] handleCallDeclined РІС‹Р·РІР°РЅ:', { caller, currentUser, isOutgoingCall });
      soundService.stopAllSounds();
      setIsOutgoingCall(false);
      setIsIncomingCall(false);
      // РџРѕРєР°Р·С‹РІР°РµРј СѓРІРµРґРѕРјР»РµРЅРёРµ Р·РІРѕРЅСЏС‰РµРјСѓ, С‡С‚Рѕ Р·РІРѕРЅРѕРє РѕС‚РєР»РѕРЅРµРЅ
      if (caller?.id === currentUser?.id) {
        console.log('Р—РІРѕРЅРѕРє РѕС‚РєР»РѕРЅРµРЅ РїРѕР»СѓС‡Р°С‚РµР»РµРј!');
        // Р”Р»СЏ Р·РІРѕРЅСЏС‰РµРіРѕ - Р·Р°РІРµСЂС€Р°РµРј Р·РІРѕРЅРѕРє РїРѕР»РЅРѕСЃС‚СЊСЋ
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

    // РћР±СЂР°Р±РѕС‚С‡РёРєРё РґР»СЏ WebSocket СЃРѕР±С‹С‚РёР№ P2P Р·РІРѕРЅРєРѕРІ
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

    // РџРѕРґРїРёСЃС‹РІР°РµРјСЃСЏ РЅР° WebSocket СЃРѕР±С‹С‚РёСЏ P2P Р·РІРѕРЅРєРѕРІ
    websocketService.onP2PIncomingCall(handleP2PIncomingCall);
    websocketService.onP2PCallAccepted(handleP2PCallAccepted);
    websocketService.onP2PCallDeclined(handleP2PCallDeclined);
    websocketService.onP2PAcceptCall(handleAcceptCall);

    // РЎР»СѓС€Р°РµРј РіР»РѕР±Р°Р»СЊРЅС‹Рµ СЃРѕР±С‹С‚РёСЏ РІРјРµСЃС‚Рѕ РїСЂСЏРјС‹С… WebSocket РѕР±СЂР°Р±РѕС‚С‡РёРєРѕРІ
    if (typeof window !== 'undefined') {
      window.addEventListener('p2p-incoming-call', handleIncomingCall);
      window.addEventListener('p2p-call-accepted', handleCallAccepted);
      window.addEventListener('p2p-call-declined', handleCallDeclined);
      window.addEventListener('p2p-call-ended', handleCallEndedEvent);
    }

    return () => {
      // РћС‚РїРёСЃС‹РІР°РµРјСЃСЏ РѕС‚ WebSocket СЃРѕР±С‹С‚РёР№
      websocketService.off('p2p-incoming-call', handleP2PIncomingCall);
      websocketService.off('p2p-call-accepted', handleP2PCallAccepted);
      websocketService.off('p2p-call-declined', handleP2PCallDeclined);
      websocketService.off('p2p-accept-call', handleAcceptCall);
      
      // РћС‚РїРёСЃС‹РІР°РµРјСЃСЏ РѕС‚ window СЃРѕР±С‹С‚РёР№ РїСЂРё СЂР°Р·РјРѕРЅС‚РёСЂРѕРІР°РЅРёРё
      if (typeof window !== 'undefined') {
        window.removeEventListener('p2p-incoming-call', handleIncomingCall);
        window.removeEventListener('p2p-call-accepted', handleCallAccepted);
        window.removeEventListener('p2p-call-declined', handleCallDeclined);
        window.removeEventListener('p2p-call-ended', handleCallEndedEvent);
      }
      p2pVoiceService.off('remote_stream_received', handleRemoteStream);
    };
  }, [currentUser, friends, callee]);
  
  // useEffect РґР»СЏ РѕР±СЂР°Р±РѕС‚РєРё РёР·РјРµРЅРµРЅРёР№ remoteStream
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
        console.error('РћС€РёР±РєР° Р·Р°РіСЂСѓР·РєРё РґР°РЅРЅС‹С… Рѕ РґСЂСѓР·СЊСЏС…:', error)
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
      // TODO: РџРѕРєР°Р·Р°С‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ СѓРІРµРґРѕРјР»РµРЅРёРµ РѕР± СѓСЃРїРµС…Рµ
    } catch (error: any) {
      console.error('РћС€РёР±РєР° РґРѕР±Р°РІР»РµРЅРёСЏ РІ РґСЂСѓР·СЊСЏ:', error)
      setAddFriendError(error.response?.data?.detail || 'РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°РїСЂРѕСЃ')
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
      console.error('РћС€РёР±РєР° РїСЂРёРЅСЏС‚РёСЏ Р·Р°РїСЂРѕСЃР°:', error);
    }
  };

  const handleRejectRequest = async (requestId: number) => {
    try {
      await friendService.rejectFriendRequest(requestId);
      setPendingRequests(prev => prev.filter(req => req.request_id !== requestId));
    } catch (error) {
      console.error('РћС€РёР±РєР° РѕС‚РєР»РѕРЅРµРЅРёСЏ Р·Р°РїСЂРѕСЃР°:', error);
    }
  };

  const handleCallUser = (user: User) => {
    if (!currentUser) return;
    setCallee(user); // РєРѕРіРѕ РІС‹Р·С‹РІР°РµРј
    setCaller(currentUser); // РєС‚Рѕ РІС‹Р·С‹РІР°РµС‚
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
            {contact.is_online ? 'Р’ СЃРµС‚Рё' : contact.is_friend === false ? 'Р›РёС‡РЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ' : 'РќРµ РІ СЃРµС‚Рё'}
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
          <div>
            <h3 className="text-xs font-bold uppercase text-[#999aa1] mb-2">
              Р’ СЃРµС‚Рё вЂ” {onlineContacts.length}
            </h3>
            {onlineContacts.length > 0 ? (
              onlineContacts.map(renderContactRow)
            ) : (
              <div className="text-center text-[#999aa1] mt-20">
                <p>РќРёРєРѕРіРѕ РЅРµС‚ РІ СЃРµС‚Рё.</p>
              </div>
            )}
          </div>
        )
      case 'all':
        return (
          <div>
            <h3 className="text-xs font-bold uppercase text-[#999aa1] mb-2">
              Р›РёС‡РЅС‹Рµ СЃРѕРѕР±С‰РµРЅРёСЏ вЂ” {sidebarContacts.length}
            </h3>
            {sidebarContacts.length > 0 ? (
              sidebarContacts.map(renderContactRow)
            ) : (
              <div className="text-center text-[#999aa1] mt-20">
                <p>Р—РґРµСЃСЊ РїРѕРєР° РЅРёРєРѕРіРѕ РЅРµС‚. РќР°РїРёС€РёС‚Рµ РєРѕРјСѓ-РЅРёР±СѓРґСЊ РёР»Рё РґРѕР±Р°РІСЊС‚Рµ РґСЂСѓР·РµР№.</p>
              </div>
            )}
          </div>
        )
      case 'pending':
        return (
          <div>
            <h3 className="text-xs font-bold uppercase text-[#999aa1] mb-2">
              Р’С…РѕРґСЏС‰РёРµ вЂ” {pendingRequests.length}
            </h3>
            {pendingRequests.length > 0 ? (
               pendingRequests.filter(Boolean).map(request => (
                <div key={request.request_id} className="flex items-center justify-between p-2 hover:bg-[#393a3f] rounded-md">
                  <div className="flex items-center">
                    <UserAvatar user={request} />
                    <div className="ml-3">
                      <p className="text-white">{request.username}</p>
                      <p className="text-xs text-[#999aa1]">Р’С…РѕРґСЏС‰РёР№ Р·Р°РїСЂРѕСЃ РІ РґСЂСѓР·СЊСЏ</p>
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
              <p className="text-center text-[#999aa1] mt-20">РќРµС‚ РѕР¶РёРґР°СЋС‰РёС… Р·Р°РїСЂРѕСЃРѕРІ РІ РґСЂСѓР·СЊСЏ.</p>
            )}
          </div>
        )
      default:
        return <p className="text-center text-[#999aa1] mt-20">РљРѕРЅС‚РµРЅС‚ РґР»СЏ "{activeTab}" РµС‰Рµ РЅРµ СЂРµР°Р»РёР·РѕРІР°РЅ.</p>
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
              setInCall(true); // РЎСЂР°Р·Сѓ РїРµСЂРµС…РѕРґРёРј РІ СЃРѕСЃС‚РѕСЏРЅРёРµ Р·РІРѕРЅРєР°
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
              // Р•СЃР»Рё caller РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ, РёСЃРїРѕР»СЊР·СѓРµРј СЃРѕС…СЂР°РЅРµРЅРЅСѓСЋ РёРЅС„РѕСЂРјР°С†РёСЋ
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
            is_muted: false, // Р’Р°Рј РЅСѓР¶РЅРѕ Р±СѓРґРµС‚ СѓРїСЂР°РІР»СЏС‚СЊ СЌС‚РёРј СЃРѕСЃС‚РѕСЏРЅРёРµРј
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
        serverName="РџСЂРёРІР°С‚РЅС‹Р№ Р·РІРѕРЅРѕРє"
      />
      )}



      {/* Friends List and Controls Sidebar */}
      <div className="app-sidebar flex h-full flex-col border-r">
        {/* Top bar for friends page */}
        <div className="flex h-12 flex-shrink-0 items-center border-b border-border px-4 shadow-md">
          <div className="flex items-center">
            <Users className="w-6 h-6 text-[#999aa1] mr-2" />
            <h2 className="text-white font-semibold">Р”СЂСѓР·СЊСЏ</h2>
          </div>
        </div>
        <nav className="flex items-center p-2 space-x-2">
          <button onClick={() => setActiveTab('all')} className={`px-2 py-1 text-sm font-medium rounded ${activeTab === 'all' ? 'bg-[#414248] text-white' : 'text-[#999aa1] hover:bg-[#3e3f45] hover:text-white'}`}>Р’СЃРµ</button>
          <div className="relative">
            <button onClick={() => setActiveTab('pending')} className={`px-2 py-1 text-sm font-medium rounded ${activeTab === 'pending' ? 'bg-[#414248] text-white' : 'text-[#999aa1] hover:bg-[#3e3f45] hover:text-white'}`}>РћР¶РёРґР°РЅРёРµ</button>
            {pendingRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center font-bold">
                {pendingRequests.length}
              </span>
            )}
          </div>
         
          <button onClick={() => setIsAddFriendModalOpen(true)} className="px-2 py-1 text-sm font-medium rounded bg-[#2d7d46] text-white hover:bg-green-600">Р”РѕР±Р°РІРёС‚СЊ</button>
        </nav>
        <div className="p-2 overflow-y-auto">
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
             <h3 className="text-xl font-bold text-white mb-4">Р’С‹Р±РµСЂРёС‚Рµ РґСЂСѓРіР°</h3>
             <p>Р’С‹Р±РµСЂРёС‚Рµ РґСЂСѓРіР° РёР· СЃРїРёСЃРєР° СЃР»РµРІР°, С‡С‚РѕР±С‹ РЅР°С‡Р°С‚СЊ РїРµСЂРµРїРёСЃРєСѓ.</p>
          </div>
        )}
      </div>

      {/* Add Friend Modal */}
      {isAddFriendModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[#323339] p-6 rounded-lg w-96">
            <h2 className="text-xl font-bold text-white mb-4">Р”РѕР±Р°РІРёС‚СЊ РІ РґСЂСѓР·СЊСЏ</h2>
            <p className="text-[#999aa1] text-sm mb-4">
              Р’РІРµРґРёС‚Рµ Р»РѕРіРёРЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (@username), Р° РЅРµ РѕС‚РѕР±СЂР°Р¶Р°РµРјРѕРµ РёРјСЏ. Р РµРіРёСЃС‚СЂ Р±СѓРєРІ РЅРµ РІР°Р¶РµРЅ.
            </p>
            <input
              type="text"
              value={friendUsername}
              onChange={(e) => setFriendUsername(e.target.value)}
              placeholder="РќР°РїСЂРёРјРµСЂ: sava РёР»Рё @sava"
              className="w-full bg-[#1e1f22] text-white rounded px-3 py-2 mb-4 border border-[#393a41] focus:ring-2 focus:ring-[#5865f2]"
            />
            {addFriendError && <p className="text-red-500 text-sm mb-4">{addFriendError}</p>}
            <div className="flex justify-end">
              <button onClick={() => setIsAddFriendModalOpen(false)} className="text-white mr-4">РћС‚РјРµРЅР°</button>
              <button onClick={handleAddFriend} className="bg-[#5865f2] text-white px-4 py-2 rounded">РћС‚РїСЂР°РІРёС‚СЊ Р·Р°РїСЂРѕСЃ</button>
            </div>
          </div>
        </div>
      )}
      
      {/* РЎРєСЂС‹С‚С‹Р№ audio СЌР»РµРјРµРЅС‚ РґР»СЏ РІРѕСЃРїСЂРѕРёР·РІРµРґРµРЅРёСЏ РІС…РѕРґСЏС‰РµРіРѕ Р°СѓРґРёРѕ РёР· P2P Р·РІРѕРЅРєРѕРІ */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        style={{ display: 'none' }}
      />
    </div>
  )
}
