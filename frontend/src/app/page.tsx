'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'

import { ConnectionStatus } from '../components/ConnectionStatus'
import { useVoiceStore } from '../store/slices/voiceSlice'
import voiceService from '../services/voiceService'
import websocketService from '../services/websocketService'


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
  const [sharingUsers, setSharingUsers] = useState<{ userId: number; username: string }[]>([])
  const [connectionStatus, setConnectionStatus] = useState({
    isConnected: true,
    isReconnecting: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 60,
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
  }, [sharingUsers, user]);



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
      </div>
      
      {/* Индикатор состояния подключения */}
      <ConnectionStatus
        isConnected={connectionStatus.isConnected}
        isReconnecting={connectionStatus.isReconnecting}
        reconnectAttempts={connectionStatus.reconnectAttempts}
        maxReconnectAttempts={connectionStatus.maxReconnectAttempts}
        lastError={connectionStatus.lastError}
      />


    </div>
  )
}