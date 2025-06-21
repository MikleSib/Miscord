import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Headphones, Wifi, WifiOff, AlertTriangle } from 'lucide-react';

interface VoiceConnectionStatusProps {
  isConnected: boolean;
  channelName?: string;
  participantCount: number;
  isMuted: boolean;
  isDeafened: boolean;
}

export function VoiceConnectionStatus({ 
  isConnected, 
  channelName, 
  participantCount, 
  isMuted, 
  isDeafened 
}: VoiceConnectionStatusProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Показываем статус голосового подключения только при проблемах
    setIsVisible(!isConnected);
  }, [isConnected]);

  if (!isVisible || !channelName) return null;

  return (
    <div className="fixed bottom-20 left-4 z-40 transition-all duration-300">
      <div className="bg-red-600 border border-red-500 rounded-lg shadow-lg px-3 py-2 max-w-64">
        <div className="flex items-center gap-2 text-white">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">
              Голосовое подключение потеряно
            </div>
            <div className="text-xs text-gray-200 truncate">
              {channelName} • {participantCount} участников
            </div>
          </div>
          
          <div className="flex gap-1 flex-shrink-0">
            {isMuted && <MicOff className="w-3 h-3 text-gray-300" />}
            {isDeafened && <Headphones className="w-3 h-3 text-gray-300" />}
          </div>
        </div>
      </div>
    </div>
  );
} 