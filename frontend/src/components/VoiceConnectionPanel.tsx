import React, { useState, useEffect } from 'react';
import { Phone, PhoneOff, Monitor, MonitorOff, Wifi, WifiOff, Loader } from 'lucide-react';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useStore } from '../lib/store';
import { getParticipantsText } from '../lib/utils';
import voiceService from '../services/voiceService';

export function VoiceConnectionPanel() {
  const { 
    isConnected, 
    currentVoiceChannelId, 
    participants, 
    disconnectFromVoiceChannel 
  } = useVoiceStore();
  
  const { currentServer } = useStore();
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');

  // Получаем название текущего канала
  const currentChannel = currentServer?.channels.find((channel: any) => 
    Number(channel.id) === currentVoiceChannelId && channel.type === 'voice'
  );

  // Обновляем статус демонстрации экрана
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

  // Обновляем статус подключения
  useEffect(() => {
    if (isConnected) {
      setConnectionStatus('connected');
    } else if (currentVoiceChannelId) {
      setConnectionStatus('connecting');
    } else {
      setConnectionStatus('disconnected');
    }
  }, [isConnected, currentVoiceChannelId]);



  // Не показываем панель если не подключены к голосовому каналу
  if (!currentVoiceChannelId) {
    return null;
  }

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      voiceService.stopScreenShare();
    } else {
      await voiceService.startScreenShare();
    }
  };

  const handleDisconnect = () => {
    disconnectFromVoiceChannel();
  };



  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Подключено';
      case 'connecting':
        return 'Подключение...';
      default:
        return 'Отключено';
    }
  };

  const getConnectionStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Wifi className="w-4 h-4 text-green-400" />;
      case 'connecting':
        return <Loader className="w-4 h-4 text-yellow-400 animate-spin" />;
      default:
        return <WifiOff className="w-4 h-4 text-red-400" />;
    }
  };

  return (
    <div className="w-[315px] bg-[#36373e] rounded-t-lg border-t border-[#4e4f56] shadow-lg animate-slide-up">
      {/* Заголовок с названием канала */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#4e4f56]">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <Phone className="w-4 h-4 text-green-400 flex-shrink-0" />
            {getConnectionStatusIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">
              {currentChannel?.name || `Голосовой канал ${currentVoiceChannelId}`}
            </div>
            <div className="text-xs text-[#b5bac1]">
              {getConnectionStatusText()} • {getParticipantsText(participants.length)}
            </div>
          </div>
        </div>
      </div>

      {/* Кнопки управления */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Кнопка демонстрации экрана */}
          <button
            onClick={handleToggleScreenShare}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              isScreenSharing
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-[#5865f2] text-white hover:bg-[#4752c4]'
            }`}
            title={isScreenSharing ? 'Остановить демонстрацию экрана' : 'Демонстрация экрана'}
          >
            {isScreenSharing ? (
              <>
                <MonitorOff className="w-4 h-4" />
                <span>Остановить</span>
              </>
            ) : (
              <>
                <Monitor className="w-4 h-4" />
                <span>Демка</span>
              </>
            )}
          </button>
        </div>

        {/* Кнопка отключения */}
        <button
          onClick={handleDisconnect}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
          title="Отключиться от голосового канала"
        >
          <PhoneOff className="w-4 h-4" />
          <span>Отключиться</span>
        </button>
      </div>
    </div>
  );
} 