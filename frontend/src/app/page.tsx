'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { UserPanel } from '../components/UserPanel'
import { ScreenShareOverlay } from '../components/ScreenShareOverlay'
import { ScreenShareToast } from '../components/ScreenShareToast'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { useVoiceStore } from '../store/slices/voiceSlice'
import voiceService from '../services/voiceService'
import websocketService from '../services/websocketService'
import { Button } from '../components/ui/button'
import { Monitor } from 'lucide-react'

export default function HomePage() {
  const router = useRouter()
  const { user, token, isAuthenticated } = useAuthStore()
  const { 
    servers, 
    currentServer, 
    currentChannel, 
    loadServers, 
    initializeWebSocket,
    disconnectWebSocket,
    isLoading 
  } = useStore()
  const { isConnected, currentVoiceChannelId } = useVoiceStore()
  const [isMounted, setIsMounted] = useState(false)
  const [isScreenShareVisible, setIsScreenShareVisible] = useState(false)
  const [sharingUsers, setSharingUsers] = useState<{ userId: number; username: string }[]>([])
  const [toastNotifications, setToastNotifications] = useState<{ userId: number; username: string; id: string }[]>([])
  const [connectionStatus, setConnectionStatus] = useState({
    isConnected: true,
    isReconnecting: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    lastError: undefined as string | undefined
  })

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

      // Инициализируем WebSocket для уведомлений
      initializeWebSocket(token)

      // Загружаем серверы пользователя
      await loadServers()

      // Запрашиваем разрешение на уведомления
      if ('Notification' in window && Notification.permission === 'default') {
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
    if (!user || !token) {
      router.push('/login')
      return
    }
    
    loadServers()
  }, [user, token, router, loadServers])

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
      // Открываем overlay
      setIsScreenShareVisible(true);
    };

    // Обработчик событий screen_share_start из WebSocket
    const handleScreenShareStartEvent = (event: any) => {
      const { user_id, username } = event.detail;
      
      setSharingUsers(prev => {
        if (!prev.find(u => u.userId === user_id)) {
          // Показываем Toast уведомление только если это не мы сами
          const currentUser = user;
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
  }, [sharingUsers, isScreenShareVisible, user]);

  // Функции для работы с Toast уведомлениями
  const handleViewScreenShare = (userId: number, username: string) => {
    const event = new CustomEvent('open_screen_share', {
      detail: { userId, username }
    });
    window.dispatchEvent(event);
  };

  const handleDismissToast = (toastId: string) => {
    setToastNotifications(prev => prev.filter(toast => toast.id !== toastId));
  };

  if (!isMounted) {
    return null // Предотвращаем гидратацию
  }

  if (!isAuthenticated || !user || !token) {
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
    <div className="h-screen flex bg-background">
      <ServerList />
      <ChannelSidebar />
      <div className="flex-1 flex flex-col">
        <ChatArea />
        <UserPanel />
      </div>
      
      {/* Плавающая кнопка для просмотра демонстрации экрана (мобильная версия) */}
      {sharingUsers.length > 0 && !isScreenShareVisible && (
        <div className="fixed bottom-20 right-4 z-40 md:hidden">
          <Button
            onClick={() => setIsScreenShareVisible(true)}
            className="h-14 w-14 rounded-full bg-green-600 hover:bg-green-700 shadow-lg"
            size="sm"
          >
            <div className="flex flex-col items-center">
              <Monitor className="w-6 h-6 text-white" />
              <div className="w-2 h-2 bg-white rounded-full animate-pulse mt-1" />
            </div>
          </Button>
          {sharingUsers.length > 1 && (
            <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold">
              {sharingUsers.length}
            </div>
          )}
        </div>
      )}
      
      {/* Overlay для демонстрации экрана */}
      <ScreenShareOverlay
        isVisible={isScreenShareVisible}
        onClose={() => setIsScreenShareVisible(false)}
        sharingUsers={sharingUsers}
      />

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
    </div>
  )
}