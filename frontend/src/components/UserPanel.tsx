'use client'

import React, { useState, useEffect } from 'react';
import { Avatar, Box, Typography, IconButton, Divider } from '@mui/material';
import { Settings, LogOut, Mic, MicOff, VolumeX, Volume2, PhoneOff, Monitor } from 'lucide-react';
import { useAuthStore } from '../store/store';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useStore } from '../lib/store';
import { useRouter } from 'next/navigation';

export function UserPanel() {
  const { user, logout } = useAuthStore();
  const { 
    isConnected, 
    isMuted, 
    isDeafened, 
    toggleMute, 
    toggleDeafen, 
    disconnectFromVoiceChannel,
    currentVoiceChannelId 
  } = useVoiceStore();
  const { currentServer } = useStore();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Логирование изменений состояния
  useEffect(() => {
    console.log('🎙️ UserPanel - состояние голосового подключения изменилось:', {
      isConnected,
      currentVoiceChannelId,
      isMuted,
      isDeafened
    });
  }, [isConnected, currentVoiceChannelId, isMuted, isDeafened]);

  if (!user || !isMounted) {
    return null;
  }

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  // Находим текущий голосовой канал
  const currentVoiceChannel = currentServer?.channels.find(
    c => c.type === 'voice' && c.id === currentVoiceChannelId
  );

  return (
    <Box
      sx={{
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Информация о голосовом подключении */}
      {isConnected && currentVoiceChannel && (
        <Box
          sx={{
            padding: '8px 12px',
            backgroundColor: 'rgba(67, 181, 129, 0.1)',
            borderBottom: '1px solid rgba(67, 181, 129, 0.2)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: '#43b581',
                animation: 'pulse 2s infinite',
              }}
            />
            <Typography variant="caption" sx={{ color: '#43b581', fontWeight: 600 }}>
              Голосовое подключение
            </Typography>
            <IconButton 
              size="small" 
              onClick={disconnectFromVoiceChannel}
              sx={{ 
                ml: 'auto',
                color: '#b9bbbe',
                '&:hover': { color: '#f04747' }
              }}
              title="Отключиться"
            >
              <PhoneOff size={14} />
            </IconButton>
          </Box>
          
          <Typography variant="body2" sx={{ color: '#dcddde', fontWeight: 500 }}>
            {currentServer?.name}
          </Typography>
          <Typography variant="caption" sx={{ color: '#72767d' }}>
            # {currentVoiceChannel.name}
          </Typography>
          
          {/* Контроллеры голоса */}
          <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
            <IconButton 
              size="small" 
              onClick={toggleMute}
              sx={{ 
                color: isMuted ? '#f04747' : '#b9bbbe',
                backgroundColor: isMuted ? 'rgba(240, 71, 71, 0.1)' : 'rgba(79, 84, 92, 0.4)',
                border: isMuted ? '1px solid #f04747' : '1px solid transparent',
                borderRadius: '4px',
                width: 32,
                height: 32,
                '&:hover': {
                  backgroundColor: isMuted ? 'rgba(240, 71, 71, 0.2)' : 'rgba(79, 84, 92, 0.6)',
                }
              }}
              title={isMuted ? 'Включить микрофон' : 'Отключить микрофон'}
            >
              {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </IconButton>
            
            <IconButton 
              size="small" 
              onClick={toggleDeafen}
              sx={{ 
                color: isDeafened ? '#f04747' : '#b9bbbe',
                backgroundColor: isDeafened ? 'rgba(240, 71, 71, 0.1)' : 'rgba(79, 84, 92, 0.4)',
                border: isDeafened ? '1px solid #f04747' : '1px solid transparent',
                borderRadius: '4px',
                width: 32,
                height: 32,
                '&:hover': {
                  backgroundColor: isDeafened ? 'rgba(240, 71, 71, 0.2)' : 'rgba(79, 84, 92, 0.6)',
                }
              }}
              title={isDeafened ? 'Включить звук' : 'Отключить звук'}
            >
              {isDeafened ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </IconButton>

            <IconButton 
              size="small"
              sx={{ 
                color: '#b9bbbe',
                backgroundColor: 'rgba(79, 84, 92, 0.4)',
                borderRadius: '4px',
                width: 32,
                height: 32,
                '&:hover': {
                  backgroundColor: 'rgba(79, 84, 92, 0.6)',
                }
              }}
              title="Демонстрация экрана"
            >
              <Monitor size={16} />
            </IconButton>
          </Box>
        </Box>
      )}

      {/* Основная панель пользователя */}
      <Box
        sx={{
          height: '52px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Avatar sx={{ width: 32, height: 32, fontSize: '14px' }}>
            {user.avatar ? (
              <img src={user.avatar} alt={user.username} />
            ) : (
              user.username[0].toUpperCase()
            )}
          </Avatar>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, color: '#dcddde' }}>
              {user.username}
            </Typography>
            <Typography variant="caption" sx={{ color: '#72767d' }}>
              Онлайн
            </Typography>
          </Box>
        </Box>
        
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton size="small" sx={{ color: '#b9bbbe' }}>
            <Settings size={16} />
          </IconButton>
          <IconButton size="small" onClick={handleLogout} sx={{ color: '#b9bbbe' }}>
            <LogOut size={16} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}