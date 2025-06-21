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
import { useVoiceStore } from '../store/slices/voiceSlice'
import voiceService from '../services/voiceService'

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
            // Здесь нужно получить имя пользователя, пока используем ID
            return [...prev, { userId, username: `User ${userId}` }];
          }
          return prev;
        } else {
          // Удаляем пользователя из списка
          return prev.filter(u => u.userId !== userId);
        }
      });
    };

    voiceService.onScreenShareChange(handleScreenShareChange);

    // Показываем overlay если есть пользователи демонстрирующие экран
    const checkScreenShare = () => {
      const hasScreenShare = sharingUsers.length > 0 || voiceService.getScreenSharingStatus();
      setIsScreenShareVisible(hasScreenShare);
    };

    checkScreenShare();
  }, [sharingUsers]);

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
      
      {/* Overlay для демонстрации экрана */}
      <ScreenShareOverlay
        isVisible={isScreenShareVisible}
        onClose={() => setIsScreenShareVisible(false)}
        sharingUsers={sharingUsers}
      />
    </div>
  )
}