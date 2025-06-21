'use client'

import React, { useState, useEffect } from 'react';
import { Avatar, Box, Typography, IconButton } from '@mui/material';
import { Settings, LogOut, Mic, MicOff, Headphones, PhoneOff, Monitor, MonitorOff } from 'lucide-react';
import { useAuthStore } from '../store/store';
import { useRouter } from 'next/navigation';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import voiceService from '../services/voiceService';

export function UserPanel() {
  const { user, logout } = useAuthStore();
  const { currentVoiceChannelId, isMuted, isDeafened, disconnectFromVoiceChannel } = useVoiceStore();
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Подписываемся на изменения статуса демонстрации экрана
    const updateScreenShareStatus = () => {
      setIsScreenSharing(voiceService.getScreenSharingStatus());
    };

    // Проверяем статус при загрузке
    updateScreenShareStatus();

    // Можно добавить слушатель событий если нужно
    const interval = setInterval(updateScreenShareStatus, 1000);
    
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleMuteToggle = () => {
    voiceService.setMuted(!isMuted);
  };

  const handleDeafenToggle = () => {
    voiceService.setDeafened(!isDeafened);
  };

  const handleDisconnect = () => {
    disconnectFromVoiceChannel();
  };

  const handleScreenShareToggle = async () => {
    if (isScreenSharing) {
      voiceService.stopScreenShare();
    } else {
      await voiceService.startScreenShare();
    }
    setIsScreenSharing(voiceService.getScreenSharingStatus());
  };

  if (!user) return null;

  return (
    <div className="h-16 bg-secondary border-t border-border flex items-center justify-between px-4">
      {/* Информация о пользователе */}
      <div className="flex items-center gap-3">
        <Avatar 
          sx={{ 
            width: 32, 
            height: 32, 
            fontSize: '14px',
            backgroundColor: 'rgb(88, 101, 242)',
            fontWeight: 600,
          }}
        >
          {user.username[0].toUpperCase()}
        </Avatar>
        <div>
          <Typography 
            sx={{ 
              fontWeight: 600, 
              fontSize: '14px', 
              color: 'rgb(220, 221, 222)',
              lineHeight: 1.2,
            }}
          >
            {user.username}
          </Typography>
          <Typography 
            sx={{ 
              fontSize: '12px', 
              color: 'rgb(163, 166, 170)',
              lineHeight: 1,
            }}
          >
            {currentVoiceChannelId ? 'В голосовом канале' : 'Онлайн'}
          </Typography>
        </div>
      </div>

      {/* Кнопки управления голосом */}
      {currentVoiceChannelId && (
        <div className="flex items-center gap-1">
          {/* Кнопка микрофона */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMuteToggle}
            className={cn(
              "w-8 h-8 p-0",
              isMuted ? 'bg-red-600 hover:bg-red-700 text-white' : 'hover:bg-accent'
            )}
          >
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>

          {/* Кнопка наушников */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeafenToggle}
            className={cn(
              "w-8 h-8 p-0",
              isDeafened ? 'bg-red-600 hover:bg-red-700 text-white' : 'hover:bg-accent'
            )}
          >
            <Headphones className="w-4 h-4" />
          </Button>

          {/* Кнопка демонстрации экрана */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleScreenShareToggle}
            className={cn(
              "w-8 h-8 p-0",
              isScreenSharing ? 'bg-green-600 hover:bg-green-700 text-white' : 'hover:bg-accent'
            )}
          >
            {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
          </Button>

          {/* Кнопка отключения */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            className="w-8 h-8 p-0 hover:bg-red-600 hover:text-white"
          >
            <PhoneOff className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Кнопки настроек и выхода */}
      <div className="flex items-center gap-1">
        <IconButton 
          size="small" 
          sx={{ 
            color: 'rgb(163, 166, 170)',
            '&:hover': { 
              backgroundColor: 'rgb(64, 68, 75)',
              color: 'rgb(220, 221, 222)'
            }
          }}
        >
          <Settings size={18} />
        </IconButton>
        
        <IconButton 
          size="small" 
          onClick={handleLogout}
          sx={{ 
            color: 'rgb(163, 166, 170)',
            '&:hover': { 
              backgroundColor: 'rgb(237, 66, 69)',
              color: 'white'
            }
          }}
        >
          <LogOut size={18} />
        </IconButton>
      </div>
    </div>
  );
}