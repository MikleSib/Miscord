import React, { useState, useEffect } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';

interface ScreenShareViewerProps {
  isVisible: boolean;
  onClose: () => void;
  sharingUsers: Array<{
    userId: number;
    username: string;
    avatar_url?: string;
  }>;
  currentChannelName: string;
  currentServerName: string;
}

export function ScreenShareViewer({ 
  isVisible, 
  onClose, 
  sharingUsers, 
  currentChannelName, 
  currentServerName 
}: ScreenShareViewerProps) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Автоматически выбираем первого пользователя при появлении стримов
  useEffect(() => {
    if (sharingUsers.length > 0 && !selectedUserId) {
      setSelectedUserId(sharingUsers[0].userId);
    }
  }, [sharingUsers, selectedUserId]);

  // Всегда рендерим контейнер, даже если не видим, чтобы VoiceService мог найти его
  if (!isVisible || sharingUsers.length === 0) {
    return (
      <div 
        id="screen-share-container-chat" 
        className="hidden"
        style={{ display: 'none' }}
      />
    );
  }

  const selectedUser = sharingUsers.find(user => user.userId === selectedUserId);
  const isScreenSharing = selectedUser !== undefined;

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  return (
    <>
      {/* Main Screen Share Area - показывается только когда НЕ свернуто */}
      {!isMinimized && (
        <div className="fixed top-0 right-0 bottom-0 left-80 z-40 bg-black">
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 z-10 bg-black/80 backdrop-blur-sm border-b border-gray-700">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-white font-medium">
                    {currentChannelName} - Экран {selectedUser?.username || 'Неизвестно'}
                  </span>
                </div>
                <div className="text-gray-400 text-sm">
                  720p 30 кадров в секунду В ЭФИРЕ
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleMinimize}
                  className="p-2 hover:bg-gray-700 rounded text-gray-300 hover:text-white transition-colors"
                  title="Свернуть"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleFullscreen}
                  className="p-2 hover:bg-gray-700 rounded text-gray-300 hover:text-white transition-colors"
                  title="Полноэкранный режим"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-700 rounded text-gray-300 hover:text-white transition-colors"
                  title="Закрыть"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex h-full pt-12">
            {/* Main Screen Share Area */}
            <div className="flex-1 flex items-center justify-center relative">
              <div 
                id="screen-share-container-chat" 
                className="w-full h-full flex items-center justify-center"
              >
                {/* Видео элементы будут добавлены сюда через VoiceService */}
                <div className="text-center text-gray-400">
                  <p>Загрузка видео потока от {selectedUser?.username}...</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Minimized State - показывается только когда свернуто */}
      {isMinimized && (
        <div className="fixed bottom-4 right-4 z-50 bg-gray-800 rounded-lg p-3 shadow-lg border border-gray-700" style={{ left: '320px' }}>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
            <span className="text-white text-sm">
              {selectedUser?.username} демонстрирует экран
            </span>
            <button
              onClick={handleMinimize}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
