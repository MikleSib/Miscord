'use client'

import { MobileExperience } from '../components/mobile/MobileExperience'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { HomePageContent } from '../components/HomePageContent'
import { ScreenShareToast } from '../components/ScreenShareToast'
import P2PCallUI from '../components/P2PCallUI'
import P2POutgoingCallUI from '../components/P2POutgoingCallUI'
import { VoiceOverlay } from '../components/VoiceOverlay'
import { useVoiceStore } from '../store/slices/voiceSlice'
import voiceService from '../services/voiceService'
import websocketService from '../services/websocketService'
import { openScreenShareView } from '../lib/screenShareNavigation'
import { ScreenShareVideoPool } from '../components/ScreenShareVideoPool'
import { ScreenShareViewerHost } from '../components/ScreenShareViewerHost'
import { ScreenSharePickerModal } from '../components/ScreenSharePickerModal'
import soundService from '../services/soundService'
import p2pVoiceService from '../services/p2pVoiceService'
import { Button } from '../components/ui/button'
import { Monitor } from 'lucide-react'
import { useAppInitialization } from '../hooks/redux'
import { ServerUserSidebar } from '../components/ServerUserSidebar'
import { UserProfileBar } from '../components/UserProfileBar'
import { VoiceConnectionPanel } from '../components/VoiceConnectionPanel'
import SettingsModal from '../components/SettingsModal'
import authService from '../services/authService'
import { User } from '../types'
import { bindUserProfileSync } from '../lib/userProfileSync'
import { bindMemberSync } from '../lib/memberSync'

bindUserProfileSync()
bindMemberSync()

export default function HomePage() {
  const router = useRouter()
  const { user: authUser, token, isAuthenticated } = useAuthStore()
  const { 
    servers, 
    currentServer, 
    currentChannel, 
    loadServers, 
    initializeWebSocket,
    disconnectWebSocket,
    isLoading,
    user: storeUser,
    setUser: setStoreUser
  } = useStore()
  const { isConnected, currentVoiceChannelId } = useVoiceStore()
  const { isInitialized } = useAppInitialization()
  const [isMounted, setIsMounted] = useState(false)
  const [sharingUsers, setSharingUsers] = useState<{ userId: number; username: string }[]>([])
  const [toastNotifications, setToastNotifications] = useState<{ userId: number; username: string; id: string }[]>([])
  const [showUserSidebar, setShowUserSidebar] = useState(true)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<'profile' | 'voice'>('profile')

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isMounted) return

    const initializeApp = async () => {
      // РџСЂРѕРІРµСЂСЏРµРј Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёСЋ
      if (!isAuthenticated || !token) {
        // РџРѕРїСЂРѕР±СѓРµРј РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РёР· С‚РѕРєРµРЅР°
        try {
          if (typeof window !== 'undefined') {
            const savedToken = localStorage.getItem('access_token');
            if (savedToken) {
              // РЈСЃС‚Р°РЅР°РІР»РёРІР°РµРј С‚РѕРєРµРЅ РІ store
              useAuthStore.getState().setToken(savedToken);
              
              // РџРѕР»СѓС‡Р°РµРј РґР°РЅРЅС‹Рµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
              const user = await authService.getCurrentUser();
              useAuthStore.getState().loginSuccess(user, savedToken);
              setStoreUser(user);
              
              return; // РџСЂРѕРґРѕР»Р¶Р°РµРј РёРЅРёС†РёР°Р»РёР·Р°С†РёСЋ
            }
          }
        } catch (error) {
          console.error('[HomePage] РћС€РёР±РєР° РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ:', error);
          // РўРѕРєРµРЅ РЅРµРґРµР№СЃС‚РІРёС‚РµР»РµРЅ, РѕС‡РёС‰Р°РµРј РµРіРѕ
          if (typeof window !== 'undefined') {
            localStorage.removeItem('access_token');
          }
          useAuthStore.getState().logout();
        }
        
        router.push('/login')
        return
      }

      // РРЅРёС†РёР°Р»РёР·РёСЂСѓРµРј WebSocket РґР»СЏ СѓРІРµРґРѕРјР»РµРЅРёР№
      initializeWebSocket(token)

      // Р—Р°РіСЂСѓР¶Р°РµРј СЃРµСЂРІРµСЂС‹ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
      await loadServers()

      // Р—Р°РїСЂР°С€РёРІР°РµРј СЂР°Р·СЂРµС€РµРЅРёРµ РЅР° СѓРІРµРґРѕРјР»РµРЅРёСЏ
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
      }
    }

    initializeApp()

    // РћС‡РёСЃС‚РєР° РїСЂРё СЂР°Р·РјРѕРЅС‚РёСЂРѕРІР°РЅРёРё
    return () => {
      disconnectWebSocket()
    }
  }, [isMounted, token, isAuthenticated, router, initializeWebSocket, loadServers, disconnectWebSocket])

  useEffect(() => {
    // РџРѕРґРїРёСЃС‹РІР°РµРјСЃСЏ РЅР° РёР·РјРµРЅРµРЅРёСЏ РґРµРјРѕРЅСЃС‚СЂР°С†РёРё СЌРєСЂР°РЅР°
    const handleScreenShareChange = (userId: number, isSharing: boolean) => {
      setSharingUsers(prev => {
        if (isSharing) {
          if (!prev.find(u => u.userId === userId)) {
            const isSelf = authUser?.id === userId;
            const username = isSelf
              ? (authUser.display_name?.trim() || authUser.username || 'Р’С‹')
              : (prev.find((u) => u.userId === userId)?.username ?? '');

            // Toast С‚РѕР»СЊРєРѕ С‡РµСЂРµР· handleScreenShareStartEvent (С‚Р°Рј РёРјСЏ СЃ СЃРµСЂРІРµСЂР° Рё РїСЂРѕРІРµСЂРєР° В«РЅРµ СЏВ»)
            return [...prev, { userId, username: username || `User ${userId}` }];
          }
          return prev;
        }
        return prev.filter(u => u.userId !== userId);
      });
    };

    const handleOpenScreenShare = (event: any) => {
      const { userId, username } = event.detail;
      // Р”РѕР±Р°РІР»СЏРµРј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РІ СЃРїРёСЃРѕРє РµСЃР»Рё РµРіРѕ РЅРµС‚
      setSharingUsers(prev => {
        if (!prev.find(u => u.userId === userId)) {
          return [...prev, { userId, username }];
        }
        return prev;
      });
    };

    // РћР±СЂР°Р±РѕС‚С‡РёРє СЃРѕР±С‹С‚РёР№ screen_share_start РёР· WebSocket
    const handleScreenShareStartEvent = (event: any) => {
      const { user_id, username, display_name } = event.detail;
      const streamerId = Number(user_id);
      if (!Number.isFinite(streamerId)) return;

      const streamerName =
        (typeof display_name === 'string' && display_name.trim()) ||
        (typeof username === 'string' && username.trim()) ||
        `User ${streamerId}`;

      const isSelf = authUser?.id === streamerId;

      setSharingUsers(prev => {
        if (prev.find(u => u.userId === streamerId)) {
          return prev.map((u) =>
            u.userId === streamerId ? { ...u, username: streamerName } : u
          );
        }

        if (!isSelf) {
          const toastId = `${streamerId}-${Date.now()}`;
          setToastNotifications((prevToasts) => [
            ...prevToasts,
            { userId: streamerId, username: streamerName, id: toastId },
          ]);
        }

        return [...prev, { userId: streamerId, username: streamerName }];
      });
    };

    // РџРѕРґРїРёСЃС‹РІР°РµРјСЃСЏ РЅР° РёР·РјРµРЅРµРЅРёСЏ СЃС‚Р°С‚СѓСЃР° РїРѕРґРєР»СЋС‡РµРЅРёСЏ WebSocket
    const unsubscribeScreenShare = voiceService.onScreenShareChange(handleScreenShareChange);
    if (typeof window !== 'undefined') {
      window.addEventListener('open_screen_share', handleOpenScreenShare);
      window.addEventListener('screen_share_start', handleScreenShareStartEvent);
    }

    return () => {
      unsubscribeScreenShare()
      if (typeof window !== 'undefined') {
        window.removeEventListener('open_screen_share', handleOpenScreenShare);
        window.removeEventListener('screen_share_start', handleScreenShareStartEvent);
      }
    };
  }, [authUser]);

  // РЎРѕСЃС‚РѕСЏРЅРёРµ РґР»СЏ P2P Р·РІРѕРЅРєРѕРІ
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isOutgoingCall, setIsOutgoingCall] = useState(false);
  const [currentCaller, setCurrentCaller] = useState<User | null>(null);
  const currentCallerRef = useRef<User | null>(null);
  const [currentCallee, setCurrentCallee] = useState<User | null>(null);

  useEffect(() => {
    currentCallerRef.current = currentCaller
  }, [currentCaller])
  const [inCall, setInCall] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // РћР±СЂР°Р±РѕС‚С‡РёРєРё P2P Р·РІРѕРЅРєРѕРІ - РґРѕР»Р¶РЅС‹ СЂР°Р±РѕС‚Р°С‚СЊ РЅР° РІСЃРµС… СЃС‚СЂР°РЅРёС†Р°С…
  useEffect(() => {
    if (!authUser || !currentServer) return;

    const handleIncomingCall = (incomingCaller: any) => {
      console.log('[HomePage] handleIncomingCall:', { incomingCaller, authUser });
      // incomingCaller СЃРѕРґРµСЂР¶РёС‚ { type: 'p2p-incoming-call', caller: User }
      // РќР°Рј РЅСѓР¶РµРЅ СЃР°Рј РѕР±СЉРµРєС‚ caller
      const caller = incomingCaller.caller || incomingCaller;
      setCurrentCaller(caller);
      setCurrentCallee(authUser);
      setIsIncomingCall(true);
      soundService.playIncomingCallSound();
      // РЎРѕС…СЂР°РЅСЏРµРј РёРЅС„РѕСЂРјР°С†РёСЋ Рѕ Р·РІРѕРЅСЏС‰РµРј РІ СЃРµСЂРІРёСЃРµ
      p2pVoiceService.setCurrentCaller(caller);
    };

    const handleCallAccepted = (data: any) => {
      console.log('[HomePage] handleCallAccepted:', data);
      setIsIncomingCall(false);
      setIsOutgoingCall(false);
      soundService.stopAllSounds();
      setInCall(true);
      // РРЅРёС†РёР°С‚РѕСЂ Р·РІРѕРЅРєР° (caller) СЃРѕР·РґР°РµС‚ offer РїРѕСЃР»Рµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ
      // Р•СЃР»Рё СЏ - РёРЅРёС†РёР°С‚РѕСЂ Р·РІРѕРЅРєР° (caller), С‚Рѕ СЏ СЃРѕР·РґР°СЋ offer РґР»СЏ РїРѕР»СѓС‡Р°С‚РµР»СЏ
      if (currentCallerRef.current?.id === authUser?.id) {
          p2pVoiceService.createOffer(data.recipient.id);
      }
      // Р•СЃР»Рё СЏ - РїСЂРёРЅРёРјР°СЋС‰РёР№ (callee), С‚Рѕ СЏ СѓР¶Рµ СЃРѕР·РґР°Р» peer connection РІ acceptCall
      // Рё Р¶РґСѓ offer РѕС‚ Р·РІРѕРЅСЏС‰РµРіРѕ
    };

    const handleCallDeclined = (data: any) => {
      console.log('[HomePage] handleCallDeclined:', data);
      soundService.stopAllSounds();
      setIsOutgoingCall(false);
      setIsIncomingCall(false);
      // РџРѕРєР°Р·С‹РІР°РµРј СѓРІРµРґРѕРјР»РµРЅРёРµ Р·РІРѕРЅСЏС‰РµРјСѓ, С‡С‚Рѕ Р·РІРѕРЅРѕРє РѕС‚РєР»РѕРЅРµРЅ
      if (currentCallerRef.current?.id === authUser?.id) {
        console.log('Р—РІРѕРЅРѕРє РѕС‚РєР»РѕРЅРµРЅ РїРѕР»СѓС‡Р°С‚РµР»РµРј!');
        // Р”Р»СЏ Р·РІРѕРЅСЏС‰РµРіРѕ - Р·Р°РІРµСЂС€Р°РµРј Р·РІРѕРЅРѕРє РїРѕР»РЅРѕСЃС‚СЊСЋ
        handleCallEnded();
      }
    };

    const handleCallEnded = (data?: any) => {
      console.log('[HomePage] handleCallEnded:', data);
      setIsIncomingCall(false);
      setIsOutgoingCall(false);
      setCurrentCaller(null);
      setCurrentCallee(null);
      setInCall(false);
      setRemoteStream(null);
      soundService.stopAllSounds();
    };

    const handleRemoteStream = (stream: MediaStream) => {
      console.log('[HomePage] Received remote stream:', stream);
      setRemoteStream(stream);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.volume = 1.0;
        remoteAudioRef.current.play().catch(e => console.error('[HomePage] Error playing remote audio:', e));
      }
    };

    websocketService.on('p2p-incoming-call', handleIncomingCall);
    websocketService.on('p2p-call-accepted', handleCallAccepted);
    websocketService.on('p2p-call-declined', handleCallDeclined);
    websocketService.on('p2p-call-ended', handleCallEnded);
    p2pVoiceService.on('remote_stream_received', handleRemoteStream);

    return () => {
      websocketService.off('p2p-incoming-call', handleIncomingCall);
      websocketService.off('p2p-call-accepted', handleCallAccepted);
      websocketService.off('p2p-call-declined', handleCallDeclined);
      websocketService.off('p2p-call-ended', handleCallEnded);
      p2pVoiceService.off('remote_stream_received', handleRemoteStream);
    };
  }, [authUser, currentServer]);

  // useEffect РґР»СЏ РѕР±СЂР°Р±РѕС‚РєРё РёР·РјРµРЅРµРЅРёР№ remoteStream
  useEffect(() => {
    if (remoteStream && remoteAudioRef.current) {
      console.log('[HomePage] Setting remote stream to audio element');
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.volume = 1.0;
      remoteAudioRef.current.play().catch(e => console.error('[HomePage] Error playing remote audio in useEffect:', e));
    }
  }, [remoteStream]);

  const handleCallEnded = () => {
    setIsIncomingCall(false);
    setIsOutgoingCall(false);
    setCurrentCaller(null);
    setCurrentCallee(null);
    setInCall(false);
    setRemoteStream(null);
    soundService.stopAllSounds();
  };

  const handleAcceptCall = () => {
    console.log('[HomePage] handleAcceptCall called, currentCaller:', currentCaller, 'authUser:', authUser);
    if (currentCaller) {
      console.log('[HomePage] Accepting call from:', currentCaller.id);
      soundService.stopAllSounds();
      setIsIncomingCall(false);
      p2pVoiceService.acceptCall(currentCaller.id, currentCaller);
      setInCall(true);
    } else {
      console.error('[HomePage] No caller information available for accept');
    }
  };

  const handleDeclineCall = () => {
    console.log('[HomePage] handleDeclineCall called, currentCaller:', currentCaller);
    if (currentCaller && currentCaller.id) {
      console.log('[HomePage] Declining call from:', currentCaller.id);
      soundService.stopAllSounds();
      setIsIncomingCall(false);
      p2pVoiceService.declineCall(currentCaller.id);
    } else {
      console.error('[HomePage] No caller information available for decline');
    }
  };

  const handleCancelCall = () => {
    if (currentCallee) {
      soundService.stopAllSounds();
      setIsOutgoingCall(false);
      p2pVoiceService.hangUp(currentCallee.id);
    }
  };

  const handleHangUp = () => {
    const peerId = currentCaller?.id === authUser?.id ? currentCallee?.id : currentCaller?.id;
    if (peerId) {
      p2pVoiceService.hangUp(peerId);
    }
    handleCallEnded();
  };

  // Р¤СѓРЅРєС†РёРё РґР»СЏ СЂР°Р±РѕС‚С‹ СЃ Toast СѓРІРµРґРѕРјР»РµРЅРёСЏРјРё
  const handleViewScreenShare = (userId: number, username: string) => {
    openScreenShareView(userId, username);
    setToastNotifications(prev => prev.filter(toast => toast.userId !== userId));
  };

  const handleDismissToast = (toastId: string) => {
    setToastNotifications(prev => prev.filter(toast => toast.id !== toastId));
  };

  const handleOpenSettings = () => {
    // Р’ РіРѕР»РѕСЃРѕРІРѕРј РєР°РЅР°Р»Рµ СЃСЂР°Р·Сѓ РѕС‚РєСЂС‹РІР°РµРј В«Р“РѕР»РѕСЃ Рё РІРёРґРµРѕВ»
    setSettingsInitialTab(currentVoiceChannelId ? 'voice' : 'profile')
    setIsSettingsModalOpen(true)
  }

  const handleCloseSettings = () => {
    setIsSettingsModalOpen(false)
  }

  if (!isMounted) {
    return null // РџСЂРµРґРѕС‚РІСЂР°С‰Р°РµРј РіРёРґСЂР°С‚Р°С†РёСЋ
  }

  if (!isAuthenticated || !authUser || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="skeleton mx-auto mb-4 h-8 w-8 rounded-lg"></div>
          <p>РџСЂРѕРІРµСЂРєР° Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёРё...</p>
        </div>
      </div>
    )
  }

  // РџРѕРєР°Р·С‹РІР°РµРј Р»РѕР°РґРµСЂ С‚РѕР»СЊРєРѕ РїСЂРё РїРµСЂРІРѕР№ Р·Р°РіСЂСѓР·РєРµ, РёРЅР°С‡Рµ РјРѕРґР°Р»РєРё (РЅР°СЃС‚СЂРѕР№РєРё РєР°РЅР°Р»Р°) СЃР»РµС‚Р°СЋС‚
  if (isLoading && servers.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="skeleton mx-auto mb-4 h-8 w-8 rounded-lg"></div>
          <p>Р—Р°РіСЂСѓР·РєР° СЃРµСЂРІРµСЂРѕРІ...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell relative flex h-[100dvh] overflow-hidden">
      <div className="relative z-50">
      <MobileExperience />
      <ServerList />
      </div>

      {currentServer ? (
        <>
          <ScreenShareVideoPool />
          <ScreenShareViewerHost showMemberSidebar={showUserSidebar} />
          <ScreenSharePickerModal />
          <div className="relative z-40">
            <ChannelSidebar />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <ChatArea showUserSidebar={showUserSidebar} setShowUserSidebar={setShowUserSidebar} />
          </div>
          {showUserSidebar && <ServerUserSidebar />}
        </>
      ) : (
        <HomePageContent />
      )}

      {/* P2P Call UI Components */}
      {isIncomingCall && currentCaller && authUser && (
        <P2PCallUI
          caller={currentCaller}
          callee={authUser}
          onAccept={handleAcceptCall}
          onDecline={handleDeclineCall}
        />
      )}

      {isOutgoingCall && currentCallee && (
        <P2POutgoingCallUI
          callee={currentCallee}
          onCancel={handleCancelCall}
        />
      )}

      {inCall && currentCallee && currentCaller && (
        <VoiceOverlay
          onHangUp={handleHangUp}
          participantsList={[
            {
              user_id: currentCaller.id,
              username: currentCaller.username,
              display_name: currentCaller.username,
              avatar_url: currentCaller.avatar_url,
              is_muted: false,
              is_deafened: false,
            },
            {
              user_id: currentCallee.id,
              username: currentCallee.username,
              display_name: currentCallee.username,
              avatar_url: currentCallee.avatar_url,
              is_muted: false,
              is_deafened: false,
            },
          ]}
          channelName={`${currentCaller.username} & ${currentCallee.username}`}
          serverName="РџСЂРёРІР°С‚РЅС‹Р№ Р·РІРѕРЅРѕРє"
        />
      )}

      {/* РЎРєСЂС‹С‚С‹Р№ audio СЌР»РµРјРµРЅС‚ РґР»СЏ РІРѕСЃРїСЂРѕРёР·РІРµРґРµРЅРёСЏ РІС…РѕРґСЏС‰РµРіРѕ Р°СѓРґРёРѕ РёР· P2P Р·РІРѕРЅРєРѕРІ */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        style={{ display: 'none' }}
      />

      {/* Р•РґРёРЅС‹Р№ dock: РіРѕР»РѕСЃ + РїСЂРѕС„РёР»СЊ (РєР°Рє РІ Discord) */}
      <div className="user-dock absolute bottom-2 left-2 z-50">
        <VoiceConnectionPanel />
        <UserProfileBar embedded onSettingsClick={handleOpenSettings} />
      </div>

      {/* РРЅРґРёРєР°С‚РѕСЂ СЃРѕСЃС‚РѕСЏРЅРёСЏ РїРѕРґРєР»СЋС‡РµРЅРёСЏ */}
      {/* Toast СѓРІРµРґРѕРјР»РµРЅРёСЏ */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toastNotifications.map((toast) => (
          <ScreenShareToast
            key={toast.id}
            username={toast.username}
            userId={toast.userId}
            onView={() => handleViewScreenShare(toast.userId, toast.username)}
            onDismiss={() => handleDismissToast(toast.id)}
          />
        ))}
      </div>

      {/* РњРѕРґР°Р» РЅР°СЃС‚СЂРѕРµРє */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={handleCloseSettings}
        initialTab={settingsInitialTab}
      />
    </div>
  )
}
