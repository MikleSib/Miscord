'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { HomePageContent } from '../components/HomePageContent'
import { ScreenShareToast } from '../components/ScreenShareToast'
import { ConnectionStatus } from '../components/ConnectionStatus'
import P2PCallUI from '../components/P2PCallUI'
import P2POutgoingCallUI from '../components/P2POutgoingCallUI'
import { VoiceOverlay } from '../components/VoiceOverlay'
import { useVoiceStore } from '../store/slices/voiceSlice'
import voiceService from '../services/voiceService'
import websocketService from '../services/websocketService'
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
  const [connectionStatus, setConnectionStatus] = useState({
    isConnected: true,
    isReconnecting: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 60,
    lastError: undefined as string | undefined
  })
  const [showUserSidebar, setShowUserSidebar] = useState(true)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isMounted) return

    const initializeApp = async () => {
      // Проверяем аутентификацию
      if (!isAuthenticated || !token) {
        // Попробуем восстановить пользователя из токена
        try {
          if (typeof window !== 'undefined') {
            const savedToken = localStorage.getItem('access_token');
            if (savedToken) {
              // Устанавливаем токен в store
              useAuthStore.getState().setToken(savedToken);
              
              // Получаем данные пользователя
              const user = await authService.getCurrentUser();
              useAuthStore.getState().loginSuccess(user, savedToken);
              setStoreUser(user);
              
              return; // Продолжаем инициализацию
            }
          }
        } catch (error) {
          console.error('[HomePage] Ошибка восстановления пользователя:', error);
          // Токен недействителен, очищаем его
          if (typeof window !== 'undefined') {
            localStorage.removeItem('access_token');
          }
          useAuthStore.getState().logout();
        }
        
        router.push('/login')
        return
      }

      // Инициализируем WebSocket для уведомлений
      initializeWebSocket(token)

      // Загружаем серверы пользователя
      await loadServers()

      // Запрашиваем разрешение на уведомления
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
      }
    }

    initializeApp()

    // Очистка при размонтировании
    return () => {
      disconnectWebSocket()
    }
  }, [isMounted, token, isAuthenticated, router, initializeWebSocket, loadServers, disconnectWebSocket])

  useEffect(() => {
    if (!authUser || !token) {
      router.push('/login')
      return
    }
    
    loadServers()
  }, [authUser, token, router, loadServers])

  useEffect(() => {
    // Подписываемся на изменения демонстрации экрана
    const handleScreenShareChange = (userId: number, isSharing: boolean) => {
      setSharingUsers(prev => {
        if (isSharing) {
          // Добавляем пользователя если его нет в списке
          if (!prev.find(u => u.userId === userId)) {
            const username = `User ${userId}`; // Здесь нужно получить имя пользователя

            // Показываем Toast уведомление
            const toastId = `${userId}-${Date.now()}`;
            setToastNotifications(prevToasts => [
              ...prevToasts,
              { userId, username, id: toastId }
            ]);

            return [...prev, { userId, username }];
          }
          return prev;
        } else {
          // Удаляем пользователя из списка
          return prev.filter(u => u.userId !== userId);
        }
      });
    };

    const handleOpenScreenShare = (event: any) => {
      const { userId, username } = event.detail;
      // Добавляем пользователя в список если его нет
      setSharingUsers(prev => {
        if (!prev.find(u => u.userId === userId)) {
          return [...prev, { userId, username }];
        }
        return prev;
      });
    };

    // Обработчик событий screen_share_start из WebSocket
    const handleScreenShareStartEvent = (event: any) => {
      const { user_id, username } = event.detail;

      setSharingUsers(prev => {
        if (!prev.find(u => u.userId === user_id)) {
          // Показываем Toast уведомление только если это не мы сами
          const currentUser = authUser;
          if (currentUser && user_id !== currentUser.id) {
            const toastId = `${user_id}-${Date.now()}`;
            setToastNotifications(prevToasts => [
              ...prevToasts,
              { userId: user_id, username, id: toastId }
            ]);
          } else {

          }

          return [...prev, { userId: user_id, username }];
        }
        return prev;
      });
    };

    // Подписываемся на изменения статуса подключения WebSocket
    websocketService.onConnectionStatusChange((status) => {
      setConnectionStatus({
        isConnected: status.isConnected,
        isReconnecting: status.isReconnecting,
        reconnectAttempts: status.reconnectAttempts,
        maxReconnectAttempts: status.maxReconnectAttempts,
        lastError: status.lastError
      });
    });

    voiceService.onScreenShareChange(handleScreenShareChange);
    if (typeof window !== 'undefined') {
      window.addEventListener('open_screen_share', handleOpenScreenShare);
      window.addEventListener('screen_share_start', handleScreenShareStartEvent);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('open_screen_share', handleOpenScreenShare);
        window.removeEventListener('screen_share_start', handleScreenShareStartEvent);
      }
    };
  }, [sharingUsers, authUser]);

  // Состояние для P2P звонков
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isOutgoingCall, setIsOutgoingCall] = useState(false);
  const [currentCaller, setCurrentCaller] = useState<User | null>(null);
  const [currentCallee, setCurrentCallee] = useState<User | null>(null);
  const [inCall, setInCall] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Обработчики P2P звонков - должны работать на всех страницах
  useEffect(() => {
    if (!authUser) return;

    const handleIncomingCall = (incomingCaller: any) => {
      console.log('[HomePage] handleIncomingCall:', { incomingCaller, authUser });
      // incomingCaller содержит { type: 'p2p-incoming-call', caller: User }
      // Нам нужен сам объект caller
      const caller = incomingCaller.caller || incomingCaller;
      setCurrentCaller(caller);
      setCurrentCallee(authUser);
      setIsIncomingCall(true);
      soundService.playIncomingCallSound();
      // Сохраняем информацию о звонящем в сервисе
      p2pVoiceService.setCurrentCaller(caller);
    };

    const handleCallAccepted = (data: any) => {
      console.log('[HomePage] handleCallAccepted:', data);
      setIsIncomingCall(false);
      setIsOutgoingCall(false);
      soundService.stopAllSounds();
      setInCall(true);
      // Инициатор звонка (caller) создает offer после подтверждения
      // Если я - инициатор звонка (caller), то я создаю offer для получателя
      if (currentCaller?.id === authUser?.id) {
          p2pVoiceService.createOffer(data.recipient.id);
      }
      // Если я - принимающий (callee), то я уже создал peer connection в acceptCall
      // и жду offer от звонящего
    };

    const handleCallDeclined = (data: any) => {
      console.log('[HomePage] handleCallDeclined:', data);
      soundService.stopAllSounds();
      setIsOutgoingCall(false);
      setIsIncomingCall(false);
      // Показываем уведомление звонящему, что звонок отклонен
      if (currentCaller?.id === authUser?.id) {
        console.log('Звонок отклонен получателем!');
        // Для звонящего - завершаем звонок полностью
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
  }, [authUser]);

  // useEffect для обработки изменений remoteStream
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

  // Функции для работы с Toast уведомлениями
  const handleViewScreenShare = (userId: number, username: string) => {
    // Отправляем событие для открытия демонстрации в ChatArea
    if (typeof window !== 'undefined') {
      const event = new CustomEvent('open_screen_share', {
        detail: { userId, username }
      });
      window.dispatchEvent(event);
    }
    
    // Убираем Toast уведомление
    setToastNotifications(prev => prev.filter(toast => toast.userId !== userId));
  };

  const handleDismissToast = (toastId: string) => {
    setToastNotifications(prev => prev.filter(toast => toast.id !== toastId));
  };

  const handleOpenSettings = () => {
    setIsSettingsModalOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsModalOpen(false);
  };

  if (!isMounted) {
    return null // Предотвращаем гидратацию
  }

  if (!isAuthenticated || !authUser || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Проверка аутентификации...</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Загрузка серверов...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex bg-background relative">
      <div className="relative z-50">
        <ServerList />
      </div>

      {currentServer ? (
        <>
          <div className="relative z-40">
            <ChannelSidebar />
          </div>
          <div className="flex-1 flex flex-col">
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
          serverName="Приватный звонок"
        />
      )}

      {/* Скрытый audio элемент для воспроизведения входящего аудио из P2P звонков */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        style={{ display: 'none' }}
      />

      {/* Панель голосового подключения над профилем пользователя */}
      <div className="absolute bottom-20 left-2 z-50 max-w-[calc(100vw-16px)]">
        <VoiceConnectionPanel />
      </div>

      {/* Общий профиль пользователя внизу под серверами и каналами */}
      <div className="absolute bottom-2 left-2 z-50 max-w-[calc(100vw-16px)]">
        <UserProfileBar onSettingsClick={handleOpenSettings} />
      </div>

      {/* Индикатор состояния подключения */}
      <ConnectionStatus
        isConnected={connectionStatus.isConnected}
        isReconnecting={connectionStatus.isReconnecting}
        reconnectAttempts={connectionStatus.reconnectAttempts}
        maxReconnectAttempts={connectionStatus.maxReconnectAttempts}
        lastError={connectionStatus.lastError}
      />
      {/* Toast уведомления */}
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

      {/* Модал настроек */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={handleCloseSettings}
      />
    </div>
  )
}
