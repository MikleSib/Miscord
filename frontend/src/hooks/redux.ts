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
       
          const user = await authService.getCurrentUser();
          setAuthUser(user);
       
        } catch (error) {
        
          // Если не удалось восстановить из API, очищаем токен
          localStorage.removeItem('access_token');
        }
      }

      // Синхронизация между store
      if (authUser && !storeUser) {
      
        setStoreUser(authUser);
      }
    };

    initializeApp();
  }, [token, authUser, storeUser, setAuthUser, setStoreUser]);

  return { isInitialized: !!(authUser || storeUser) };
};

export {};