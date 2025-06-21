import React, { useState, useEffect } from 'react';
import { X, Monitor, MonitorOff, Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react';
import { Button } from './ui/button';
import voiceService from '../services/voiceService';

interface ScreenShareOverlayProps {
  isVisible: boolean;
  onClose: () => void;
  sharingUsers: { userId: number; username: string }[];
}

export function ScreenShareOverlay({ isVisible, onClose, sharingUsers }: ScreenShareOverlayProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (sharingUsers.length > 0 && !selectedUser) {
      setSelectedUser(sharingUsers[0].userId);
    }
  }, [sharingUsers, selectedUser]);

  // Обработчик нажатия Escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible) {
        onClose();
      }
    };

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [isVisible, onClose]);

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    onClose();
  };

  const handleBackgroundClick = (e: React.MouseEvent) => {
    // Закрываем только если клик по фону, а не по содержимому
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const toggleFullscreen = () => {
    const overlay = document.getElementById('screen-share-overlay');
    if (!overlay) return;

    if (!isFullscreen) {
      overlay.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    
    // Заглушаем/включаем все видео элементы
    sharingUsers.forEach(({ userId }) => {
      const videoElement = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement;
      if (videoElement) {
        videoElement.muted = newMuted;
      }
    });
  };

  const startScreenShare = async () => {
    const success = await voiceService.startScreenShare();
    if (!success) {
      console.error('Не удалось начать демонстрацию экрана');
    }
  };

  const stopScreenShare = () => {
    voiceService.stopScreenShare();
  };

  if (!isVisible) return null;

  const currentUser = sharingUsers.find(u => u.userId === selectedUser);
  const isScreenSharing = voiceService.getScreenSharingStatus();

  return (
    <div 
      id="screen-share-overlay"
      className={`fixed inset-0 bg-black/90 z-50 flex flex-col ${isFullscreen ? 'p-0' : 'p-2 md:p-4'}`}
      onClick={handleBackgroundClick}
    >
      {/* Заголовок */}
      <div 
        className="flex items-center justify-between p-2 md:p-4 bg-gray-900/80 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
          <Monitor className="w-4 h-4 md:w-5 md:h-5 text-green-400 flex-shrink-0" />
          <span className="text-white font-medium text-sm md:text-base truncate">
            {currentUser ? `${currentUser.username} демонстрирует экран` : 'Демонстрация экрана'}
          </span>
        </div>
        
        <div className="flex items-center gap-1 md:gap-2">
          
          {/* Кнопка звука */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMute}
            className="text-white hover:bg-gray-700 w-8 h-8 p-0 md:w-auto md:h-auto md:p-2"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          
          {/* Кнопка полноэкранного режима - только на десктопе */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="text-white hover:bg-gray-700 w-8 h-8 p-0 md:w-auto md:h-auto md:p-2 hidden md:flex"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          
          {/* Кнопка остановить демонстрацию - только если я сам стримлю */}
          {isScreenSharing && (
            <Button
              variant="destructive"
              size="sm"
              onClick={stopScreenShare}
              className="flex items-center gap-1 md:gap-2 text-xs md:text-sm px-2 py-1 md:px-3 md:py-2"
              title="Остановить мою демонстрацию экрана"
            >
              <MonitorOff className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden md:inline">Остановить мой стрим</span>
            </Button>
          )}
          
          {/* Кнопка закрытия */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="text-white hover:bg-gray-700 w-8 h-8 p-0 md:w-auto md:h-auto md:p-2"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Область для видео */}
      <div 
        id="screen-share-container" 
        className="flex-1 flex items-center justify-center relative"
        onClick={(e) => e.stopPropagation()}
      >
        {sharingUsers.length === 0 ? (
          <div className="text-center text-gray-400">
            <Monitor className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg mb-2">Никто не демонстрирует экран</p>
            <p className="text-sm">Нажмите "Поделиться" чтобы начать демонстрацию</p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {/* Видео элементы будут добавлены сюда через VoiceService */}
            <div className="text-center text-gray-400">
              <p>Загрузка видео потока...</p>
            </div>
          </div>
        )}
      </div>

      {/* Информация о демонстрации */}
      {isScreenSharing && (
        <div className="absolute bottom-4 left-4 bg-red-600/90 px-3 py-2 rounded-lg backdrop-blur-sm">
          <div className="flex items-center gap-2 text-white text-sm">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            Вы демонстрируете экран
          </div>
        </div>
      )}
    </div>
  );
} 