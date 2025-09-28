import React, { useState, useEffect } from 'react';
import { X, Maximize2, Minimize2, Users, Settings, Phone, PhoneOff } from 'lucide-react';

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

  if (!isVisible || sharingUsers.length === 0) {
    return null;
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
    <div className={`fixed inset-0 z-50 bg-black ${isMinimized ? 'pointer-events-none' : ''}`}>
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
              title={isMinimized ? 'Развернуть' : 'Свернуть'}
            >
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
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
      <div className={`flex h-full pt-12 ${isMinimized ? 'opacity-0' : ''}`}>
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

        {/* Right Sidebar - Participants and Controls */}
        <div className="w-80 bg-gray-900 border-l border-gray-700 flex flex-col">
          {/* Participants List */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center space-x-2 mb-3">
              <Users className="w-4 h-4 text-gray-400" />
              <span className="text-white font-medium">Участники</span>
            </div>
            
            <div className="space-y-2">
              {sharingUsers.map((user) => (
                <div
                  key={user.userId}
                  className={`flex items-center space-x-3 p-2 rounded cursor-pointer transition-colors ${
                    selectedUserId === user.userId 
                      ? 'bg-blue-600/20 border border-blue-500/30' 
                      : 'hover:bg-gray-800'
                  }`}
                  onClick={() => setSelectedUserId(user.userId)}
                >
                  <div className="relative">
                    <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
                      {user.avatar_url ? (
                        <img 
                          src={user.avatar_url} 
                          alt={user.username}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-white text-sm font-medium">
                          {user.username.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    {selectedUserId === user.userId && (
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-gray-900"></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">
                      {user.username}
                    </div>
                    <div className="text-gray-400 text-xs">
                      {selectedUserId === user.userId ? 'Демонстрирует экран' : 'В голосовом канале'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Voice Controls */}
          <div className="p-4 border-b border-gray-700">
            <div className="text-white font-medium mb-3">Голосовая связь по {currentChannelName} / {currentServerName}</div>
            
            <div className="space-y-2">
              {sharingUsers.map((user) => (
                <div key={user.userId} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-800">
                  <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center">
                    {user.avatar_url ? (
                      <img 
                        src={user.avatar_url} 
                        alt={user.username}
                        className="w-6 h-6 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-white text-xs font-medium">
                        {user.username.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-white text-sm">{user.username}</div>
                    <div className="text-gray-400 text-xs">Невидимый</div>
                  </div>
                  <div className="flex space-x-1">
                    <button className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white">
                      <Phone className="w-3 h-3" />
                    </button>
                    <button className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white">
                      <Settings className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Controls */}
          <div className="mt-auto p-4">
            <div className="flex items-center justify-center space-x-2">
              <button className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full text-white transition-colors">
                <Phone className="w-5 h-5" />
              </button>
              <button className="p-3 bg-red-600 hover:bg-red-700 rounded-full text-white transition-colors">
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Minimized State */}
      {isMinimized && (
        <div className="absolute bottom-4 right-4 bg-gray-800 rounded-lg p-3 shadow-lg border border-gray-700">
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
    </div>
  );
}
