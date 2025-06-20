import React, { useEffect } from 'react';
import { Box, styled } from '@mui/material';
import { useStore } from '../lib/store';
import { useVoiceStore } from '../store/slices/voiceSlice';
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
  const { currentChannel } = useStore();
  const { isConnected } = useVoiceStore();

  useEffect(() => {
    // Здесь будет загрузка каналов
    // fetchChannels();
  }, []);

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