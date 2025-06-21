import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, AlertCircle, RefreshCw } from 'lucide-react';

interface ConnectionStatusProps {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  lastError?: string;
}

export function ConnectionStatus({ 
  isConnected, 
  isReconnecting, 
  reconnectAttempts, 
  maxReconnectAttempts,
  lastError 
}: ConnectionStatusProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [autoHideTimer, setAutoHideTimer] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Показываем индикатор если есть проблемы с подключением
    if (!isConnected || isReconnecting || lastError) {
      setIsVisible(true);
      
      // Очищаем предыдущий таймер
      if (autoHideTimer) {
        clearTimeout(autoHideTimer);
      }
      
      // Автоматически скрываем через 1 секунду если соединение восстановлено
      if (isConnected && !isReconnecting && !lastError) {
        const timer = setTimeout(() => {
          setIsVisible(false);
        }, 1000);
        setAutoHideTimer(timer);
      }
    }

    return () => {
      if (autoHideTimer) {
        clearTimeout(autoHideTimer);
      }
    };
  }, [isConnected, isReconnecting, lastError]);

  if (!isVisible) return null;

  const getStatusIcon = () => {
    if (isReconnecting) {
      return <RefreshCw className="w-4 h-4 animate-spin" />;
    } else if (!isConnected) {
      return <WifiOff className="w-4 h-4" />;
    } else if (lastError) {
      return <AlertCircle className="w-4 h-4" />;
    } else {
      return <Wifi className="w-4 h-4" />;
    }
  };

  const getStatusText = () => {
    if (isReconnecting) {
      return `Переподключение... (${reconnectAttempts}/${maxReconnectAttempts})`;
    } else if (!isConnected) {
      return 'Соединение потеряно';
    } else if (lastError) {
      return 'Ошибка подключения';
    } else {
      return 'Подключено';
    }
  };

  const getStatusColor = () => {
    if (isReconnecting) {
      return 'bg-yellow-600 border-yellow-500';
    } else if (!isConnected) {
      return 'bg-red-600 border-red-500';
    } else if (lastError) {
      return 'bg-orange-600 border-orange-500';
    } else {
      return 'bg-green-600 border-green-500';
    }
  };

  return (
    <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${
      isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
    }`}>
      <div className={`${getStatusColor()} border rounded-lg shadow-lg px-4 py-2 min-w-64 max-w-96`}>
        <div className="flex items-center gap-3 text-white">
          <div className="flex-shrink-0">
            {getStatusIcon()}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">
              {getStatusText()}
            </div>
            
            {lastError && (
              <div className="text-xs text-gray-200 mt-1 truncate">
                {lastError}
              </div>
            )}
            
            {isReconnecting && (
              <div className="text-xs text-gray-200 mt-1">
                Попытка восстановить соединение...
              </div>
            )}
          </div>
          
          {/* Прогресс-бар для попыток переподключения */}
          {isReconnecting && (
            <div className="flex-shrink-0 w-12">
              <div className="bg-white bg-opacity-20 rounded-full h-2">
                <div 
                  className="bg-white rounded-full h-2 transition-all duration-300"
                  style={{ 
                    width: `${(reconnectAttempts / maxReconnectAttempts) * 100}%` 
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 