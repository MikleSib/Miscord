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
      className={`fixed inset-0 bg-black/90 z-50 flex flex-col ${isFullscreen ? 'p-0' : 'p-4'}`}
    >
      {/* Заголовок */}
      <div className="flex items-center justify-between p-4 bg-gray-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-green-400" />
          <span className="text-white font-medium">
            {currentUser ? `${currentUser.username} демонстрирует экран` : 'Демонстрация экрана'}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Переключение между пользователями */}
          {sharingUsers.length > 1 && (
            <select 
              value={selectedUser || ''} 
              onChange={(e) => setSelectedUser(Number(e.target.value))}
              className="bg-gray-800 text-white px-3 py-1 rounded border border-gray-600"
            >
              {sharingUsers.map(({ userId, username }) => (
                <option key={userId} value={userId}>{username}</option>
              ))}
            </select>
          )}
          
          {/* Кнопка звука */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMute}
            className="text-white hover:bg-gray-700"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          
          {/* Кнопка полноэкранного режима */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="text-white hover:bg-gray-700"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          
          {/* Кнопка начать/остановить демонстрацию */}
          {isScreenSharing ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={stopScreenShare}
              className="flex items-center gap-2"
            >
              <MonitorOff className="w-4 h-4" />
              Остановить
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={startScreenShare}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
            >
              <Monitor className="w-4 h-4" />
              Поделиться
            </Button>
          )}
          
          {/* Кнопка закрытия */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-white hover:bg-gray-700"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Область для видео */}
      <div 
        id="screen-share-container" 
        className="flex-1 flex items-center justify-center relative"
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