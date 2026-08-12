'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/store'
import { useStore } from '@/lib/store'
import { ServerList } from '@/components/ServerList'
import { ChannelSidebar } from '@/components/ChannelSidebar'
import { ChatArea } from '@/components/ChatArea'
import { HomePageContent } from '@/components/HomePageContent'
import { ScreenShareToast } from '@/components/ScreenShareToast'
import { useVoiceStore } from '@/store/slices/voiceSlice'
import { openScreenShareView } from '@/lib/screenShareNavigation'
import { ServerUserSidebar } from '@/components/ServerUserSidebar'
import { UserProfileBar } from '@/components/UserProfileBar'
import { VoiceConnectionPanel } from '@/components/VoiceConnectionPanel'
import authService from '@/services/authService'
import { bindUserProfileSync } from '@/lib/userProfileSync'
import { bindMemberSync } from '@/lib/memberSync'
import { bindServerPermissionsSync } from '@/lib/serverPermissions'
import { getUserSettingsTab, OPEN_USER_SETTINGS_EVENT } from '@/lib/userSettingsNavigation'
import type { UserSettingsTab } from '@/lib/userSettingsNavigation'
import { useUserDockClearance } from '@/hooks/useUserDockClearance'
import { GlobalHotkeys } from '@/components/GlobalHotkeys'
import { ServerOnboardingGate } from '@/components/server-settings/ServerOnboardingGate'
import { messageStateService } from '@/services/messageStateService'
import { useChannelUnreadStore } from '@/store/channelUnreadStore'
import { useScreenShareToasts } from '@/features/app/useScreenShareToasts'
import { useCapabilities } from '@/features/capabilities/capabilities'

const SettingsModal = dynamic(() => import('@/components/SettingsModal'), { ssr: false })
const MobileExperience = dynamic(
  () => import('@/components/mobile/MobileExperience').then((module) => module.MobileExperience),
  { ssr: false },
)
const ThreadPanel = dynamic(
  () => import('@/components/community/ThreadPanel').then((module) => module.ThreadPanel),
  { ssr: false },
)
const ThreadDialogHost = dynamic(
  () => import('@/components/community/ThreadDialogHost').then((module) => module.ThreadDialogHost),
  { ssr: false },
)
const ForumChannelView = dynamic(
  () => import('@/components/community/ForumChannelView').then((module) => module.ForumChannelView),
  { ssr: false },
)
const ScreenShareVideoPool = dynamic(
  () => import('@/components/ScreenShareVideoPool').then((module) => module.ScreenShareVideoPool),
  { ssr: false },
)
const ScreenShareViewerHost = dynamic(
  () => import('@/components/ScreenShareViewerHost').then((module) => module.ScreenShareViewerHost),
  { ssr: false },
)
const ScreenSharePickerModal = dynamic(
  () => import('@/components/ScreenSharePickerModal').then((module) => module.ScreenSharePickerModal),
  { ssr: false },
)

bindUserProfileSync()
bindMemberSync()
bindServerPermissionsSync()

export default function HomePage() {
  const capabilities = useCapabilities()
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
    setUser: setStoreUser
  } = useStore()
  const { currentVoiceChannelId } = useVoiceStore()
  const [isMounted, setIsMounted] = useState(false)
  const [showUserSidebar, setShowUserSidebar] = useState(true)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<UserSettingsTab>('profile')
  const userDockRef = useUserDockClearance()
  const screenShareToasts = useScreenShareToasts(authUser?.id)

  useEffect(() => {
    const openSettings = (event: Event) => {
      setSettingsInitialTab(getUserSettingsTab(event))
      setIsSettingsModalOpen(true)
    }
    window.addEventListener(OPEN_USER_SETTINGS_EVENT, openSettings)
    return () => window.removeEventListener(OPEN_USER_SETTINGS_EVENT, openSettings)
  }, [])

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
            const restored = await authService.restoreSession();
            if (restored.accessToken) {
              // Устанавливаем токен в store
              useAuthStore.getState().setToken(restored.accessToken);

              // Получаем данные пользователя
              useAuthStore.getState().loginSuccess(restored.user, restored.accessToken);
              setStoreUser(restored.user);

              return; // Продолжаем инициализацию
            }
          }
        } catch (error) {
          console.error('[HomePage] Ошибка восстановления пользователя:', error);
          // Токен недействителен, очищаем его
          useAuthStore.getState().logout();
        }

        router.push('/login')
        return
      }

      // Инициализируем WebSocket для уведомлений
      initializeWebSocket(token)

      // Загружаем серверы пользователя
      await loadServers()
      const unread = await messageStateService.listUnreads().catch(() => [])
      useChannelUnreadStore.getState().hydrate(unread.map((item) => ({
        messageId: item.message_id, textChannelId: item.text_channel_id,
        serverId: item.server_id, channelName: item.channel_name || undefined,
        createdAt: Date.now(),
      })))

    }

    initializeApp()

    // Очистка при размонтировании
    return () => {
      disconnectWebSocket()
    }
  }, [isMounted, token, isAuthenticated, router, initializeWebSocket, loadServers, disconnectWebSocket])

  const handleViewScreenShare = (userId: number, username: string) => {
    openScreenShareView(userId, username);
    screenShareToasts.dismissUser(userId);
  };

  const handleOpenSettings = () => {
    // Р’ голосовом канале сразу открываем «Голос и видео»
    setSettingsInitialTab(currentVoiceChannelId ? 'voice' : 'profile')
    setIsSettingsModalOpen(true)
  }

  const handleCloseSettings = () => {
    setIsSettingsModalOpen(false)
  }

  if (!isMounted) {
    return null // Предотвращаем гидратацию
  }

  if (!isAuthenticated || !authUser || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="skeleton mx-auto mb-4 h-8 w-8 rounded-lg"></div>
          <p>Проверка аутентификации...</p>
        </div>
      </div>
    )
  }

  // Показываем лоадер только при первой загрузке, иначе модалки (настройки канала) слетают
  if (isLoading && servers.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="skeleton mx-auto mb-4 h-8 w-8 rounded-lg"></div>
          <p>Загрузка серверов...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell miscord-responsive-root relative flex h-[100dvh] overflow-hidden">
      <GlobalHotkeys />
      <MobileExperience />
      {capabilities.threads && <ThreadDialogHost />}
      {currentServer && <ServerOnboardingGate server={currentServer} />}
      <div className="app-mobile-servers relative z-50">
        <ServerList />
      </div>

      {currentServer ? (
        <>
          {capabilities.screenShare && currentVoiceChannelId && <ScreenShareVideoPool />}
          {capabilities.screenShare && currentVoiceChannelId && <ScreenShareViewerHost showMemberSidebar={showUserSidebar} />}
          {capabilities.screenShare && currentVoiceChannelId && <ScreenSharePickerModal />}
          <div className="app-mobile-channels relative z-40">
            <ChannelSidebar />
          </div>
          <div className="app-mobile-chat flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1">
              <div className="flex min-w-0 flex-1">{capabilities.forums && currentChannel?.kind === 'forum' ? <ForumChannelView channel={currentChannel} /> : <ChatArea showUserSidebar={showUserSidebar} setShowUserSidebar={setShowUserSidebar} />}</div>
              {capabilities.threads && <ThreadPanel />}
            </div>
          </div>
          {showUserSidebar && (
            <div className="app-mobile-members flex h-full">
              <ServerUserSidebar />
            </div>
          )}
        </>
      ) : (
        <div className="app-mobile-home flex min-w-0 flex-1">
          <HomePageContent />
        </div>
      )}

      {/* Единый dock: голос + профиль */}
      <div ref={userDockRef} className="user-dock absolute bottom-2 left-2 z-50">
        <VoiceConnectionPanel />
        <UserProfileBar embedded onSettingsClick={handleOpenSettings} />
      </div>

      {/* Индикатор состояния подключения */}
      {/* Toast уведомления */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {screenShareToasts.items.map((toast) => (
          <ScreenShareToast
            key={toast.id}
            username={toast.username}
            userId={toast.userId}
            onView={() => handleViewScreenShare(toast.userId, toast.username)}
            onDismiss={() => screenShareToasts.dismiss(toast.id)}
          />
        ))}
      </div>

      {/* Модал настроек */}
      {isSettingsModalOpen && (
        <SettingsModal
          isOpen
          onClose={handleCloseSettings}
          initialTab={settingsInitialTab}
        />
      )}
    </div>
  )
}
