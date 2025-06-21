'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { VoiceOverlay } from '../components/VoiceOverlay'
import { useVoiceStore } from '../store/slices/voiceSlice'

export default function HomePage() {
  const router = useRouter()
  const { user, token, checkAuth } = useAuthStore()
  const { 
    servers, 
    currentServer, 
    loadServers, 
    initializeWebSocket,
    disconnectWebSocket,
    isLoading 
  } = useStore()
  const { isConnected } = useVoiceStore()
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isMounted) return

    const initializeApp = async () => {
      // Проверяем аутентификацию
      const isAuthenticated = await checkAuth()
      
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
  }, [isMounted, token, checkAuth, router, initializeWebSocket, loadServers, disconnectWebSocket])

  if (!isMounted) {
    return null // Предотвращаем гидратацию
  }

  if (!user || !token) {
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
    <div className="flex h-screen bg-background">
      {/* Список серверов */}
      <ServerList />
      
      {/* Боковая панель каналов */}
      {currentServer && (
        <ChannelSidebar />
      )}
      
      {/* Основная область чата */}
      <div className="flex-1 flex flex-col">
        {currentServer ? (
          <ChatArea />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <h2 className="text-2xl font-semibold mb-2">Добро пожаловать в Miscord!</h2>
              <p>Выберите сервер, чтобы начать общение</p>
              {servers.length === 0 && (
                <p className="mt-4">
                  У вас пока нет серверов. Создайте новый или попросите кого-то пригласить вас.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Голосовой оверлей */}
      {isConnected && <VoiceOverlay />}
    </div>
  )
}