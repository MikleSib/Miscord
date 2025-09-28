import React, { useState, useEffect } from 'react';
import { Monitor, MonitorOff } from 'lucide-react';
import { Button } from './ui/button';
import voiceService from '../services/voiceService';

interface ScreenShareButtonProps {
  className?: string;
}

export function ScreenShareButton({ className }: ScreenShareButtonProps) {
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  useEffect(() => {
    const updateScreenShareStatus = () => {
      setIsScreenSharing(voiceService.getScreenSharingStatus());
    };

    // Обновляем статус при изменении подключения
    updateScreenShareStatus();
    
    // Подписываемся на изменения статуса демонстрации экрана
    const handleScreenShareChange = () => {
      updateScreenShareStatus();
    };

    window.addEventListener('screen_share_start', handleScreenShareChange);
    window.addEventListener('screen_share_stop', handleScreenShareChange);

    return () => {
      window.removeEventListener('screen_share_start', handleScreenShareChange);
      window.removeEventListener('screen_share_stop', handleScreenShareChange);
    };
  }, []);

  const handleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        voiceService.stopScreenShare();
      } else {
        const success = await voiceService.startScreenShare();
        if (!success) {
          console.error('Не удалось начать демонстрацию экрана');
        }
      }
    } catch (error) {
      console.error('Ошибка при управлении демонстрацией экрана:', error);
    }
  };

  return (
    <Button
      variant={isScreenSharing ? "destructive" : "outline"}
      size="sm"
      onClick={handleScreenShare}
      className={className}
      title={isScreenSharing ? 'Остановить демонстрацию экрана' : 'Начать демонстрацию экрана'}
    >
      {isScreenSharing ? (
        <MonitorOff className="w-4 h-4" />
      ) : (
        <Monitor className="w-4 h-4" />
      )}
    </Button>
  );
}
