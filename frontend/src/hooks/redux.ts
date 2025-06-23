// Zustand stores are used instead of Redux
// Import stores directly in components:
// import { useAuthStore } from '../store/store';
// import { useChannelStore } from '../store/channelStore';
// import { useChatStore } from '../store/chatStore';
// import { useVoiceStore } from '../store/slices/voiceSlice';

import { useEffect } from 'react';
import { useAuthStore } from '../store/store';
import { useStore } from '../lib/store';
import authService from '../services/authService';

export const useAppInitialization = () => {
  const { user: authUser, token, isAuthenticated, setUser: setAuthUser } = useAuthStore();
  const { setUser: setStoreUser, user: storeUser } = useStore();

  useEffect(() => {
    const initializeApp = async () => {
      // Если есть токен, но нет пользователя в auth store
      if (token && !authUser) {
        try {
          console.log('[useAppInitialization] Восстановление пользователя из API');
          const user = await authService.getCurrentUser();
          setAuthUser(user);
          console.log('[useAppInitialization] Пользователь восстановлен из API:', user);
        } catch (error) {
          console.error('[useAppInitialization] Ошибка восстановления пользователя из API:', error);
          // Если не удалось восстановить из API, очищаем токен
          localStorage.removeItem('access_token');
        }
      }

      // Синхронизация между store
      if (authUser && !storeUser) {
        console.log('[useAppInitialization] Синхронизация пользователя в store:', authUser);
        setStoreUser(authUser);
      }
    };

    initializeApp();
  }, [token, authUser, storeUser, setAuthUser, setStoreUser]);

  return { isInitialized: !!(authUser || storeUser) };
};

export {};