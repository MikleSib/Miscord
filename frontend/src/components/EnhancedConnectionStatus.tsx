/**
 * 📊 Enhanced Connection Status Component
 * Мониторинг состояния WebSocket соединений с детальными метриками
 */

import React, { useState, useEffect } from 'react';
import { Clock, Wifi, WifiOff, AlertCircle, CheckCircle, TrendingUp, Users, MessageCircle } from 'lucide-react';
import enhancedWebSocketService from '../services/enhancedWebSocketService';

interface ConnectionMetrics {
  totalMessages: number;
  messagesPerSecond: number;
  averageLatency: number;
  reconnectionAttempts: number;
  lastReconnect: number;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected';
  bytesReceived: number;
  bytesSent: number;
}

const EnhancedConnectionStatus: React.FC = () => {
  const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
  const [metrics, setMetrics] = useState<ConnectionMetrics | null>(null);
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(true);

  useEffect(() => {
    // Подписка на изменения статуса соединения
    const unsubscribeStatus = enhancedWebSocketService.onConnectionStatusChange((status) => {
      setConnectionStatus(status);
    });

    // Обновление метрик каждую секунду
    const metricsInterval = setInterval(() => {
      const currentMetrics = enhancedWebSocketService.getMetrics();
      setMetrics(currentMetrics);
    }, 1000);

    return () => {
      unsubscribeStatus();
      clearInterval(metricsInterval);
    };
  }, []);

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
      case 'established':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'connecting':
        return <Clock className="w-4 h-4 text-yellow-500 animate-spin" />;
      case 'disconnected':
        return <WifiOff className="w-4 h-4 text-red-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Wifi className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
      case 'established':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'disconnected':
        return 'text-red-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getQualityColor = (quality: string) => {
    switch (quality) {
      case 'excellent':
        return 'text-green-500';
      case 'good':
        return 'text-blue-500';
      case 'poor':
        return 'text-yellow-500';
      case 'disconnected':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Подключено';
      case 'established':
        return 'Соединение установлено';
      case 'connecting':
        return 'Подключение...';
      case 'disconnected':
        return 'Отключено';
      case 'error':
        return 'Ошибка соединения';
      case 'failed':
        return 'Не удалось подключиться';
      default:
        return 'Неизвестно';
    }
  };

  if (isMinimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 bg-gray-800 text-white px-3 py-2 rounded-lg shadow-lg cursor-pointer transition-all duration-200 hover:bg-gray-700"
        onClick={() => setIsMinimized(false)}
      >
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <div className="flex items-center space-x-1">
            <div className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected' || connectionStatus === 'established'
                ? 'bg-green-500'
                : connectionStatus === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-red-500'
            }`} />
            {metrics && (
              <span className="text-xs">
                {metrics.averageLatency.toFixed(0)}ms
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-gray-800 text-white rounded-lg shadow-xl border border-gray-700 min-w-80">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <h3 className="font-semibold">Статус соединения</h3>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-gray-400 hover:text-white text-sm"
          >
            {showDetails ? 'Скрыть' : 'Детали'}
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="text-gray-400 hover:text-white"
          >
            ×
          </button>
        </div>
      </div>

      {/* Main Status */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className={`font-medium ${getStatusColor()}`}>
            {getStatusText()}
          </span>
          {metrics && (
            <span className={`text-sm ${getQualityColor(metrics.connectionQuality)}`}>
              {metrics.connectionQuality === 'excellent' && '🟢 Отлично'}
              {metrics.connectionQuality === 'good' && '🔵 Хорошо'}
              {metrics.connectionQuality === 'poor' && '🟡 Плохо'}
              {metrics.connectionQuality === 'disconnected' && '🔴 Отключено'}
            </span>
          )}
        </div>

        {metrics && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <span>
                <span className="text-gray-400">Латентность:</span>{' '}
                <span className="text-white font-mono">
                  {metrics.averageLatency.toFixed(0)}ms
                </span>
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <MessageCircle className="w-4 h-4 text-green-400" />
              <span>
                <span className="text-gray-400">Сообщений:</span>{' '}
                <span className="text-white font-mono">
                  {metrics.totalMessages}
                </span>
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-purple-400" />
              <span>
                <span className="text-gray-400">Скорость:</span>{' '}
                <span className="text-white font-mono">
                  {metrics.messagesPerSecond.toFixed(1)}/с
                </span>
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <Wifi className="w-4 h-4 text-orange-400" />
              <span>
                <span className="text-gray-400">Переподключений:</span>{' '}
                <span className="text-white font-mono">
                  {metrics.reconnectionAttempts}
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Detailed Metrics */}
        {showDetails && metrics && (
          <div className="mt-4 pt-3 border-t border-gray-700">
            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Получено данных:</span>
                <span className="text-white font-mono">
                  {formatBytes(metrics.bytesReceived)}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-400">Отправлено данных:</span>
                <span className="text-white font-mono">
                  {formatBytes(metrics.bytesSent)}
                </span>
              </div>

              {metrics.lastReconnect > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Последнее переподключение:</span>
                  <span className="text-white font-mono">
                    {new Date(metrics.lastReconnect).toLocaleTimeString()}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-gray-400">Качество соединения:</span>
                <span className={`font-mono ${getQualityColor(metrics.connectionQuality)}`}>
                  {metrics.connectionQuality.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Connection Quality Bar */}
            <div className="mt-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-400">Качество</span>
                <span className="text-xs text-gray-400">
                  {metrics.averageLatency < 100 ? 'Отлично' :
                   metrics.averageLatency < 250 ? 'Хорошо' : 'Плохо'}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    metrics.averageLatency < 100
                      ? 'bg-green-500'
                      : metrics.averageLatency < 250
                      ? 'bg-blue-500'
                      : 'bg-yellow-500'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(10, 100 - (metrics.averageLatency / 500) * 100))}%`
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {(connectionStatus === 'disconnected' || connectionStatus === 'error') && (
        <div className="p-4 pt-0">
          <button
            onClick={() => {
              // Здесь можно добавить логику переподключения
              window.location.reload();
            }}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
          >
            Переподключиться
          </button>
        </div>
      )}
    </div>
  );
};

export default EnhancedConnectionStatus; 