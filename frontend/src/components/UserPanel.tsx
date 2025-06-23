'use client'

import React, { useState, useEffect } from 'react';
import { Avatar, Box, Typography, IconButton } from '@mui/material';
import { Settings, LogOut, Mic, MicOff, Headphones, PhoneOff, Monitor, MonitorOff } from 'lucide-react';
import { useAuthStore } from '../store/store';
import { useStore } from '../lib/store';
import { useRouter } from 'next/navigation';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import voiceService from '../services/voiceService';

export function UserPanel() {
  const { user, logout } = useAuthStore();
  const { logout: logoutStore } = useStore();
  const { currentVoiceChannelId, isMuted, isDeafened, disconnectFromVoiceChannel } = useVoiceStore();
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [activeSharingUsers, setActiveSharingUsers] = useState<{ userId: number; username: string }[]>([]);
  const router = useRouter();

  useEffect(() => {
    // Подписываемся на изменения статуса демонстрации экрана
    const updateScreenShareStatus = () => {
      setIsScreenSharing(voiceService.getScreenSharingStatus());
    };

    // Обработчики событий демонстрации экрана
    const handleScreenShareStart = (event: any) => {
      const { user_id, username } = event.detail;
      setActiveSharingUsers(prev => {
        if (!prev.find(u => u.userId === user_id)) {
          return [...prev, { userId: user_id, username }];
        }
        return prev;
      });
    };

    const handleScreenShareStop = (event: any) => {
      const { user_id } = event.detail;
      setActiveSharingUsers(prev => prev.filter(u => u.userId !== user_id));
    };

    // Проверяем статус при загрузке
    updateScreenShareStatus();

    // Подписываемся на события
    window.addEventListener('screen_share_start', handleScreenShareStart);
    window.addEventListener('screen_share_stop', handleScreenShareStop);

    // Можно добавить слушатель событий если нужно
    const interval = setInterval(updateScreenShareStatus, 1000);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('screen_share_start', handleScreenShareStart);
      window.removeEventListener('screen_share_stop', handleScreenShareStop);
    };
  }, []);

  const handleLogout = () => {
    logout();
    logoutStore();
    router.push('/login');
  };

  const handleSettings = () => {
    router.push('/settings');
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

  const handleViewScreenShare = () => {
    // Создаем событие для открытия ScreenShareOverlay
    const event = new CustomEvent('open_screen_share', {
      detail: { 
        userId: activeSharingUsers[0]?.userId, 
        username: activeSharingUsers[0]?.username 
      }
    });
    window.dispatchEvent(event);
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
            title={isScreenSharing ? 'Остановить демонстрацию экрана' : 'Начать демонстрацию экрана'}
          >
            {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
          </Button>

          {/* Кнопка просмотра активных демонстраций */}
          {activeSharingUsers.length > 0 && !isScreenSharing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleViewScreenShare}
              className="w-8 h-8 p-0 bg-blue-600 hover:bg-blue-700 text-white relative"
              title={`Смотреть демонстрацию экрана: ${activeSharingUsers.map(u => u.username).join(', ')}`}
            >
              <Monitor className="w-4 h-4" />
              {activeSharingUsers.length > 1 && (
                <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {activeSharingUsers.length}
                </div>
              )}
            </Button>
          )}

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
          onClick={handleSettings}
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