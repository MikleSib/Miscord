import React, { useState, useEffect } from 'react';
import { Monitor, X, Eye } from 'lucide-react';
import { Button } from './ui/button';

interface ScreenShareToastProps {
  username: string;
  userId: number;
  onView: () => void;
  onDismiss: () => void;
}

export function ScreenShareToast({ username, userId, onView, onDismiss }: ScreenShareToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Автоматически скрываем через 10 секунд
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onDismiss, 300); // Даем время на анимацию
    }, 10000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 300);
  };

  const handleView = () => {
    onView();
    handleDismiss();
  };

  return (
    <div className={`fixed top-4 right-4 z-50 transition-all duration-300 ${
      isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
    }`}>
      <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-lg p-4 min-w-80 max-w-96">
        <div className="flex items-start gap-3">
          <div className="bg-green-600 rounded-full p-2 flex-shrink-0">
            <Monitor className="w-5 h-5 text-white" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="text-white font-medium text-sm mb-1">
              Демонстрация экрана
            </div>
            <div className="text-gray-300 text-sm mb-3">
              <span className="font-medium">{username}</span> начал демонстрацию экрана
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleView}
                className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-1 text-xs px-3 py-1"
              >
                <Eye className="w-3 h-3" />
                Смотреть
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                className="text-gray-400 hover:text-white hover:bg-gray-700 text-xs px-3 py-1"
              >
                Позже
              </Button>
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="text-gray-400 hover:text-white hover:bg-gray-700 w-6 h-6 p-0 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
} 