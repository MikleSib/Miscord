import React, { useEffect } from 'react';
import { Box, styled } from '@mui/material';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { fetchChannels } from '../store/slices/channelSlice';
import ServerList from '../components/ServerList';
import ChannelSidebar from '../components/ChannelSidebar';
import ChatArea from '../components/ChatArea';
import UserPanel from '../components/UserPanel';
import VoiceOverlay from '../components/VoiceOverlay';

const MainContainer = styled(Box)({
  display: 'flex',
  height: '100vh',
  overflow: 'hidden',
  backgroundColor: '#36393f',
});

const MainPage: React.FC = () => {
  const dispatch = useAppDispatch();
  const { currentChannel } = useAppSelector(state => state.channels);
  const { isConnected } = useAppSelector(state => state.voice);

  useEffect(() => {
    dispatch(fetchChannels());
  }, [dispatch]);

  return (
    <MainContainer>
      {/* Список серверов (каналов) слева */}
      <ServerList />
      
      {/* Боковая панель с каналами */}
      {currentChannel && (
        <ChannelSidebar channel={currentChannel} />
      )}
      
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