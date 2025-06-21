'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Hash, Monitor, MonitorOff, X, Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react'
import { useStore } from '../lib/store'
import { useAuthStore } from '../store/store'
import { formatDate } from '../lib/utils'
import { Button } from './ui/button'
import voiceService from '../services/voiceService'

export function ChatArea() {
  const { currentChannel, messages, sendMessage, addMessage } = useStore()
  const { user } = useAuthStore()
  const [messageInput, setMessageInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // Состояние для демонстрации экрана
  const [sharingUsers, setSharingUsers] = useState<{ userId: number; username: string }[]>([])
  const [selectedUser, setSelectedUser] = useState<number | null>(null)
  const [isScreenShareVisible, setIsScreenShareVisible] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)

  const channelMessages = currentChannel ? messages[currentChannel.id] || [] : []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [channelMessages])

  // Обработчики для демонстрации экрана
  useEffect(() => {
    // Подписываемся на изменения статуса демонстрации экрана
    const updateScreenShareStatus = () => {
      setIsScreenSharing(voiceService.getScreenSharingStatus());
    };

    // Обработчики событий демонстрации экрана
    const handleScreenShareStart = (event: any) => {
      const { user_id, username } = event.detail;
      setSharingUsers(prev => {
        if (!prev.find(u => u.userId === user_id)) {
          const newUsers = [...prev, { userId: user_id, username }];
          // Автоматически показываем демонстрацию если это первый пользователь
          if (newUsers.length === 1) {
            setSelectedUser(user_id);
            setIsScreenShareVisible(true);
          }
          return newUsers;
        }
        return prev;
      });
    };

    const handleScreenShareStop = (event: any) => {
      const { user_id } = event.detail;
      setSharingUsers(prev => {
        const newUsers = prev.filter(u => u.userId !== user_id);
        // Если убрали выбранного пользователя, переключаемся на другого или скрываем
        if (selectedUser === user_id) {
          if (newUsers.length > 0) {
            setSelectedUser(newUsers[0].userId);
          } else {
            setIsScreenShareVisible(false);
            setSelectedUser(null);
          }
        }
        return newUsers;
      });
    };

    const handleOpenScreenShare = (event: any) => {
      const { userId, username } = event.detail;
      // Добавляем пользователя в список если его нет
      setSharingUsers(prev => {
        if (!prev.find(u => u.userId === userId)) {
          return [...prev, { userId, username }];
        }
        return prev;
      });
      // Открываем демонстрацию
      setSelectedUser(userId);
      setIsScreenShareVisible(true);
    };

    // Проверяем статус при загрузке
    updateScreenShareStatus();

    // Подписываемся на события
    window.addEventListener('screen_share_start', handleScreenShareStart);
    window.addEventListener('screen_share_stop', handleScreenShareStop);
    window.addEventListener('open_screen_share', handleOpenScreenShare);

    const interval = setInterval(updateScreenShareStatus, 1000);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('screen_share_start', handleScreenShareStart);
      window.removeEventListener('screen_share_stop', handleScreenShareStop);
      window.removeEventListener('open_screen_share', handleOpenScreenShare);
    };
  }, [selectedUser]);

  // Функции для управления демонстрацией экрана
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

  const closeScreenShare = () => {
    setIsScreenShareVisible(false);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (messageInput.trim() && currentChannel && user && currentChannel.type === 'text') {
      // Отправляем сообщение через store
      sendMessage(messageInput)
      setMessageInput('')
    }
  }

  if (!currentChannel) {
    return (
      <div className="flex-1 bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-center">
          <p className="text-2xl mb-2">Добро пожаловать!</p>
          <p>Выберите канал для начала общения</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-background flex flex-col">
      {/* Channel Header */}
      <div className="h-12 px-4 flex items-center border-b border-border">
        <Hash className="w-5 h-5 text-muted-foreground mr-2" />
        <span className="font-semibold">{currentChannel.name}</span>
      </div>

      {/* Screen Share Area */}
      {isScreenShareVisible && sharingUsers.length > 0 && (
        <div className="bg-black border-b border-border">
          {/* Заголовок демонстрации */}
          <div className="flex items-center justify-between p-3 bg-gray-900/80 backdrop-blur-sm">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Monitor className="w-5 h-5 text-green-400 flex-shrink-0" />
              <span className="text-white font-medium text-sm truncate">
                {sharingUsers.find(u => u.userId === selectedUser)?.username} демонстрирует экран
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Переключение между пользователями */}
              {sharingUsers.length > 1 && (
                <select 
                  value={selectedUser || ''} 
                  onChange={(e) => setSelectedUser(Number(e.target.value))}
                  className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600 text-sm"
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
                className="text-white hover:bg-gray-700 w-8 h-8 p-0"
                title={isMuted ? 'Включить звук' : 'Отключить звук'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </Button>
              
              {/* Кнопка начать/остановить демонстрацию */}
              {isScreenSharing ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={stopScreenShare}
                  className="flex items-center gap-2 text-sm px-3 py-1"
                >
                  <MonitorOff className="w-4 h-4" />
                  Остановить
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={startScreenShare}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-sm px-3 py-1"
                >
                  <Monitor className="w-4 h-4" />
                  Поделиться
                </Button>
              )}
              
              {/* Кнопка закрытия */}
              <Button
                variant="ghost"
                size="sm"
                onClick={closeScreenShare}
                className="text-white hover:bg-gray-700 w-8 h-8 p-0"
                title="Закрыть демонстрацию"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Область для видео */}
          <div 
            id="screen-share-container-chat" 
            className="relative bg-black flex items-center justify-center"
            style={{ height: '300px' }}
          >
            {sharingUsers.length === 0 ? (
              <div className="text-center text-gray-400">
                <Monitor className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg mb-2">Никто не демонстрирует экран</p>
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
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 space-y-4">
          {channelMessages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>Пока что здесь нет сообщений</p>
              <p className="text-sm">Начните общение в канале #{currentChannel.name}</p>
            </div>
          ) : (
            channelMessages.map((message) => (
              <div key={message.id} className="flex gap-3 hover:bg-accent/5 px-2 py-1 rounded">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  {message.author.avatar ? (
                    <img src={message.author.avatar} alt="" className="w-full h-full rounded-full" />
                  ) : (
                    <span className="text-sm font-semibold">
                      {message.author.username[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-sm">
                      {message.author.username}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(message.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm mt-0.5">{message.content}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Message Input */}
      {currentChannel.type === 'text' && (
        <form onSubmit={handleSendMessage} className="p-4">
          <div className="bg-secondary rounded-lg flex items-center px-4">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder={`Написать в #${currentChannel.name}`}
              className="flex-1 bg-transparent py-3 outline-none text-sm"
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              disabled={!messageInput.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </form>
      )}

      {/* Voice Channel Info */}
      {currentChannel.type === 'voice' && (
        <div className="p-4 text-center text-muted-foreground">
          <p>Голосовой канал: {currentChannel.name}</p>
          <p className="text-sm">Нажмите на канал для подключения к голосовому чату</p>
        </div>
      )}
    </div>
  )
}