'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { ScreenShareToast } from '../components/ScreenShareToast'
import { ConnectionStatus } from '../components/ConnectionStatus'
import EnhancedConnectionStatus from '../components/EnhancedConnectionStatus'
import enhancedWebSocketService from '../services/enhancedWebSocketService'
import { useVoiceStore } from '../store/slices/voiceSlice'
import voiceService from '../services/voiceService'
import websocketService from '../services/websocketService'
import { Button } from '../components/ui/button'
import { Monitor } from 'lucide-react'
import { useAppInitialization } from '../hooks/redux'
import { ServerUserSidebar } from '../components/ServerUserSidebar'
import { UserProfileBar } from '../components/UserProfileBar'
import { VoiceConnectionPanel } from '../components/VoiceConnectionPanel'

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
    user: storeUser
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
  const [useEnhancedWebSocket, setUseEnhancedWebSocket] = useState(true) // 🚀 Enhanced mode по умолчанию

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isMounted) return

    const initializeApp = async () => {
      // Проверяем аутентификацию
      if (!isAuthenticated || !token) {
        router.push('/login')
        return
      }

      if (useEnhancedWebSocket) {
        // 🚀 Инициализируем Enhanced WebSocket
        const connected = await enhancedWebSocketService.connect(token)
        if (connected) {
          // Подписываемся на события
          enhancedWebSocketService.onMessage('new_message', (data) => {
            // Здесь можно добавить обработку новых сообщений
          })
          
          enhancedWebSocketService.onMessage('user_status_changed', (data) => {
            // Обработка изменения статуса пользователей
          })
          
          enhancedWebSocketService.onMessage('typing', (data) => {
            // Обработка статуса печати
          })
        }
      } else {
        // Legacy WebSocket
        initializeWebSocket(token)
      }

      // Загружаем серверы пользователя
      await loadServers()
    }

    initializeApp()

    // Очистка при размонтировании
    return () => {
      if (useEnhancedWebSocket) {
        enhancedWebSocketService.disconnect()
      } else {
        disconnectWebSocket()
      }
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
    window.addEventListener('open_screen_share', handleOpenScreenShare);
    window.addEventListener('screen_share_start', handleScreenShareStartEvent);

    return () => {
      window.removeEventListener('open_screen_share', handleOpenScreenShare);
      window.removeEventListener('screen_share_start', handleScreenShareStartEvent);
    };
  }, [sharingUsers, authUser]);

  // Функции для работы с Toast уведомлениями
  const handleViewScreenShare = (userId: number, username: string) => {
    // Отправляем событие для открытия демонстрации в ChatArea
    const event = new CustomEvent('open_screen_share', {
      detail: { userId, username }
    });
    window.dispatchEvent(event);
    
    // Убираем Toast уведомление
    setToastNotifications(prev => prev.filter(toast => toast.userId !== userId));
  };

  const handleDismissToast = (toastId: string) => {
    setToastNotifications(prev => prev.filter(toast => toast.id !== toastId));
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
      <ServerList />
      <ChannelSidebar />
      <div className="flex-1 flex flex-col">
        <ChatArea showUserSidebar={showUserSidebar} setShowUserSidebar={setShowUserSidebar} />
      </div>
      {showUserSidebar && <ServerUserSidebar />}
      
      {/* Панель голосового подключения над профилем пользователя */}
      <div className="absolute bottom-20 left-2 z-10">
        <VoiceConnectionPanel />
      </div>
      
      {/* Общий профиль пользователя внизу под серверами и каналами */}
      <div className="absolute bottom-2 left-2 z-10">
        <UserProfileBar />
      </div>
      
      {/* Индикатор состояния подключения */}
      {useEnhancedWebSocket ? (
        <EnhancedConnectionStatus />
      ) : (
        <ConnectionStatus
          isConnected={connectionStatus.isConnected}
          isReconnecting={connectionStatus.isReconnecting}
          reconnectAttempts={connectionStatus.reconnectAttempts}
          maxReconnectAttempts={connectionStatus.maxReconnectAttempts}
          lastError={connectionStatus.lastError}
        />
      )}
      
      {/* 🚀 Enterprise Mode Toggle */}
      <div className="fixed top-4 left-4 z-50">
        <Button
          onClick={() => setUseEnhancedWebSocket(!useEnhancedWebSocket)}
          className={`text-xs px-3 py-1 ${
            useEnhancedWebSocket 
              ? 'bg-green-600 hover:bg-green-700' 
              : 'bg-gray-600 hover:bg-gray-700'
          }`}
          title={useEnhancedWebSocket ? 'Enhanced WebSocket (1000+ users)' : 'Legacy WebSocket'}
        >
          {useEnhancedWebSocket ? '🚀 Enhanced' : '📞 Legacy'}
        </Button>
      </div>
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
    </div>
  )
}