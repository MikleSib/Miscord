import React, { useEffect } from 'react';
import { Box, styled, CircularProgress, Alert } from '@mui/material';
import { useRouter } from 'next/router';
import { useStore } from '../lib/store';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useAuthStore } from '../store/store';
import { ServerList } from '../components/ServerList';
import { ChannelSidebar } from '../components/ChannelSidebar';
import { ChatArea } from '../components/ChatArea';
import { UserPanel } from '../components/UserPanel';
import VoiceOverlay from '../components/VoiceOverlay';

const MainContainer = styled(Box)({
  display: 'flex',
  height: '100vh',
  overflow: 'hidden',
  backgroundColor: '#36393f',
});

const MainPage: React.FC = () => {
  const router = useRouter();
  const { currentChannel, isLoading, error, loadChannels, setUser } = useStore();
  const { isConnected } = useVoiceStore();
  const { isAuthenticated, user } = useAuthStore();

  useEffect(() => {
    // Проверяем аутентификацию
    if (!isAuthenticated || !user) {
      router.push('/login');
      return;
    }
    
    // Устанавливаем пользователя в store
    setUser(user);
    
    // Загружаем каналы
    loadChannels();
  }, [isAuthenticated, user, router, loadChannels, setUser]);

  // Показываем загрузку пока проверяем аутентификацию
  if (!isAuthenticated || !user) {
    return null;
  }

  // Показываем загрузку каналов
  if (isLoading) {
    return (
      <MainContainer>
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 2
        }}>
          <CircularProgress />
          <Box sx={{ color: '#72767d' }}>Загрузка каналов...</Box>
        </Box>
      </MainContainer>
    );
  }

  // Показываем ошибку
  if (error) {
    return (
      <MainContainer>
        <Box sx={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          padding: 2
        }}>
          <Alert severity="error" sx={{ maxWidth: 400 }}>
            {error}
          </Alert>
        </Box>
      </MainContainer>
    );
  }

  return (
    <MainContainer>
      {/* Список серверов (каналов) слева */}
      <ServerList />
      
      {/* Боковая панель с каналами */}
      <ChannelSidebar />
      
      {/* Основная область чата */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {currentChannel ? (
          <ChatArea />
        ) : (
          <Box sx={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: '#72767d'
          }}>
            Выберите канал для начала общения
          </Box>
        )}
        
        {/* Панель пользователя внизу */}
        <UserPanel />
      </Box>
      
      {/* Оверлей для голосового чата */}
      {isConnected && <VoiceOverlay />}
    </MainContainer>
  );
};

export default MainPage;