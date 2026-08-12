'use client'

import { MobileExperience } from '../components/mobile/MobileExperience'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../store/store'
import { useStore } from '../lib/store'
import { ServerList } from '../components/ServerList'
import { ChannelSidebar } from '../components/ChannelSidebar'
import { ChatArea } from '../components/ChatArea'
import { HomePageContent } from '../components/HomePageContent'
import { ScreenShareToast } from '../components/ScreenShareToast'
import { useVoiceStore } from '../store/slices/voiceSlice'
import voiceService from '../services/voiceService'
import { openScreenShareView } from '../lib/screenShareNavigation'
import { ScreenShareVideoPool } from '../components/ScreenShareVideoPool'
import { ScreenShareViewerHost } from '../components/ScreenShareViewerHost'
import { ScreenSharePickerModal } from '../components/ScreenSharePickerModal'
import { Button } from '../components/ui/button'
import { Monitor } from 'lucide-react'
import { useAppInitialization } from '../hooks/redux'
import { ServerUserSidebar } from '../components/ServerUserSidebar'
import { UserProfileBar } from '../components/UserProfileBar'
import { VoiceConnectionPanel } from '../components/VoiceConnectionPanel'
import SettingsModal from '../components/SettingsModal'
import authService from '../services/authService'
import { bindUserProfileSync } from '../lib/userProfileSync'
import { bindMemberSync } from '../lib/memberSync'
import { bindServerPermissionsSync } from '../lib/serverPermissions'
import { ThreadPanel } from '../components/community/ThreadPanel'
import { ThreadDialogHost } from '../components/community/ThreadDialogHost'
import { ForumChannelView } from '../components/community/ForumChannelView'
import { getUserSettingsTab, OPEN_USER_SETTINGS_EVENT } from '../lib/userSettingsNavigation'
import type { UserSettingsTab } from '../lib/userSettingsNavigation'
import { useUserDockClearance } from '../hooks/useUserDockClearance'
import { GlobalHotkeys } from '../components/GlobalHotkeys'

bindUserProfileSync()
bindMemberSync()
bindServerPermissionsSync()

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
  const [settingsInitialTab, setSettingsInitialTab] = useState<UserSettingsTab>('profile')
  const userDockRef = useUserDockClearance()

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

    }

    initializeApp()

    // Очистка при размонтировании
    return () => {
      disconnectWebSocket()
    }
  }, [isMounted, token, isAuthenticated, router, initializeWebSocket, loadServers, disconnectWebSocket])

  useEffect(() => {
    // Подписываемся на изменения демонстрации экрана
    const handleScreenShareChange = (userId: number, isSharing: boolean) => {
      setSharingUsers(prev => {
        if (isSharing) {
          if (!prev.find(u => u.userId === userId)) {
            const isSelf = authUser?.id === userId;
            const username = isSelf
              ? (authUser.display_name?.trim() || authUser.username || 'Вы')
              : (prev.find((u) => u.userId === userId)?.username ?? '');

            // Toast только через handleScreenShareStartEvent (там имя с сервера и проверка «не я»)
            return [...prev, { userId, username: username || `User ${userId}` }];
          }
          return prev;
        }
        return prev.filter(u => u.userId !== userId);
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
      const { user_id, username, display_name, voice_channel_id } = event.detail;
      const streamerId = Number(user_id);
      if (!Number.isFinite(streamerId)) return;

      const streamerName =
        (typeof display_name === 'string' && display_name.trim()) ||
        (typeof username === 'string' && username.trim()) ||
        `User ${streamerId}`;

      const isSelf = authUser?.id === streamerId;
      // Предлагать «Смотреть» имеет смысл только тем, кто уже в этом голосовом канале.
      const myVoiceChannelId = useVoiceStore.getState().currentVoiceChannelId;
      const streamerChannelId = Number(voice_channel_id);
      const isSameVoiceChannel =
        myVoiceChannelId != null &&
        Number.isFinite(streamerChannelId) &&
        streamerChannelId === myVoiceChannelId;

      setSharingUsers(prev => {
        if (prev.find(u => u.userId === streamerId)) {
          return prev.map((u) =>
            u.userId === streamerId ? { ...u, username: streamerName } : u
          );
        }

        if (!isSelf && isSameVoiceChannel) {
          const toastId = `${streamerId}-${Date.now()}`;
          setToastNotifications((prevToasts) => [
            ...prevToasts,
            { userId: streamerId, username: streamerName, id: toastId },
          ]);
        }

        return [...prev, { userId: streamerId, username: streamerName }];
      });
    };

    // Подписываемся на изменения статуса подключения WebSocket
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


  // Функции для работы с Toast уведомлениями
  const handleViewScreenShare = (userId: number, username: string) => {
    openScreenShareView(userId, username);
    setToastNotifications(prev => prev.filter(toast => toast.userId !== userId));
  };

  const handleDismissToast = (toastId: string) => {
    setToastNotifications(prev => prev.filter(toast => toast.id !== toastId));
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
      <ThreadDialogHost />
      <div className="app-mobile-servers relative z-50">
        <ServerList />
      </div>

      {currentServer ? (
        <>
          <ScreenShareVideoPool />
          <ScreenShareViewerHost showMemberSidebar={showUserSidebar} />
          <ScreenSharePickerModal />
          <div className="app-mobile-channels relative z-40">
            <ChannelSidebar />
          </div>
          <div className="app-mobile-chat flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1">
              <div className="flex min-w-0 flex-1">{currentChannel?.kind === 'forum' ? <ForumChannelView channel={currentChannel} /> : <ChatArea showUserSidebar={showUserSidebar} setShowUserSidebar={setShowUserSidebar} />}</div>
              <ThreadPanel />
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
        initialTab={settingsInitialTab}
      />
    </div>
  )
}
