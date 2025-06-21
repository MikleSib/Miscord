'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Hash, Monitor, MonitorOff, X, Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react'
import { useStore } from '../lib/store'
import { useAuthStore } from '../store/store'
import { formatDate } from '../lib/utils'
import { Button } from './ui/button'
import voiceService from '../services/voiceService'
import { cn } from '../lib/utils'

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
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [videoHealthCheck, setVideoHealthCheck] = useState<NodeJS.Timeout | null>(null)

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
      console.log('🖥️ ChatArea: Получено событие остановки демонстрации для пользователя:', user_id);
      
      setSharingUsers(prev => {
        const newUsers = prev.filter(u => u.userId !== user_id);
        console.log('🖥️ ChatArea: Обновлен список стримеров:', newUsers);
        
        // Удаляем видео элемент отключившегося пользователя
        const videoElement = document.getElementById(`remote-video-${user_id}`);
        if (videoElement) {
          videoElement.remove();
          console.log(`🖥️ ChatArea: Удален видео элемент для пользователя ${user_id}`);
        }
        
        // Если убрали выбранного пользователя, переключаемся на другого или скрываем
        if (selectedUser === user_id) {
          console.log('🖥️ ChatArea: Выбранный пользователь остановил стрим');
          
          if (newUsers.length > 0) {
            console.log('🖥️ ChatArea: Переключаемся на другого стримера:', newUsers[0].username);
            
            // Немедленно обновляем выбранного пользователя
            setSelectedUser(newUsers[0].userId);
            
            // Принудительно обновляем видео контейнер для нового стримера
            setTimeout(() => {
              const newVideoElement = document.getElementById(`remote-video-${newUsers[0].userId}`);
              const videoContainer = document.getElementById('screen-share-container-chat');
              
              console.log(`🖥️ ChatArea: Попытка переключения на ${newUsers[0].userId}`, {
                newVideoElement: !!newVideoElement,
                videoContainer: !!videoContainer,
                newUserId: newUsers[0].userId,
                allVideoElements: Array.from(document.querySelectorAll('[id^="remote-video-"]')).map(el => el.id)
              });
              
              if (newVideoElement && videoContainer) {
                // Скрываем все видео элементы
                Array.from(videoContainer.children).forEach(child => {
                  if (child instanceof HTMLVideoElement) {
                    child.style.display = 'none';
                  }
                });
                
                // Показываем нужный элемент
                newVideoElement.style.display = 'block';
                
                // Перемещаем в контейнер если не там
                if (!videoContainer.contains(newVideoElement)) {
                  videoContainer.appendChild(newVideoElement);
                }
                
                console.log(`🖥️ ChatArea: Переключен видео контейнер на пользователя ${newUsers[0].userId}`);
              } else {
                console.error(`🖥️ ChatArea: Не удалось переключить на пользователя ${newUsers[0].userId}`, {
                  newVideoElement: !!newVideoElement,
                  videoContainer: !!videoContainer,
                  allVideoElements: Array.from(document.querySelectorAll('[id^="remote-video-"]')).map(el => ({
                    id: el.id,
                    display: (el as HTMLElement).style.display,
                    parent: el.parentElement?.id
                  }))
                });
                
                // Попробуем найти любой доступный видео элемент
                const availableVideo = document.querySelector(`[id^="remote-video-"]:not([id="remote-video-${user_id}"])`) as HTMLVideoElement;
                if (availableVideo && videoContainer) {
                  console.log('🖥️ ChatArea: Найден альтернативный видео элемент:', availableVideo.id);
                  availableVideo.style.display = 'block';
                  if (!videoContainer.contains(availableVideo)) {
                    videoContainer.appendChild(availableVideo);
                  }
                }
              }
            }, 100);
          } else {
            console.log('🖥️ ChatArea: Никого не осталось, закрываем демонстрацию');
            setIsScreenShareVisible(false);
            setSelectedUser(null);
            
            // Очищаем контейнер когда никого не осталось
            const videoContainer = document.getElementById('screen-share-container-chat');
            if (videoContainer) {
              videoContainer.innerHTML = '';
              console.log('🖥️ Очищен контейнер - никого не осталось');
            }
          }
        } else {
          // Если остановил стрим не выбранный пользователь, просто удаляем его из списка
          console.log('🖥️ ChatArea: Остановил стрим не выбранный пользователь, оставляем текущего');
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

    // Обработчики для полноэкранного режима
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    // Проверяем статус при загрузке
    updateScreenShareStatus();

    // Обработчик отключения пользователя от голосового канала
    const handleVoiceChannelLeave = (event: any) => {
      const { user_id } = event.detail;
      console.log('🖥️ ChatArea: Пользователь покинул голосовой канал:', user_id);
      
      // Проверяем, был ли этот пользователь в списке стримеров
      setSharingUsers(prev => {
        const userWasSharing = prev.some(u => u.userId === user_id);
        if (userWasSharing) {
          console.log('🖥️ ChatArea: Стример покинул канал, удаляем из списка');
          const newUsers = prev.filter(u => u.userId !== user_id);
          
          // Если это был выбранный пользователь
          if (selectedUser === user_id) {
            if (newUsers.length > 0) {
              setSelectedUser(newUsers[0].userId);
            } else {
              setIsScreenShareVisible(false);
              setSelectedUser(null);
              const videoContainer = document.getElementById('screen-share-container-chat');
              if (videoContainer) {
                videoContainer.innerHTML = '';
                console.log('🖥️ Очищен контейнер - стример покинул канал');
              }
            }
          }
          
          // Удаляем видео элемент
          const videoElement = document.getElementById(`remote-video-${user_id}`);
          if (videoElement) {
            videoElement.remove();
            console.log(`🖥️ ChatArea: Удален видео элемент покинувшего пользователя ${user_id}`);
          }
          
          return newUsers;
        }
        return prev;
      });
    };

    // Подписываемся на события
    window.addEventListener('screen_share_start', handleScreenShareStart);
    window.addEventListener('screen_share_stop', handleScreenShareStop);
    window.addEventListener('open_screen_share', handleOpenScreenShare);
    window.addEventListener('voice_channel_leave', handleVoiceChannelLeave);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const interval = setInterval(updateScreenShareStatus, 1000);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('screen_share_start', handleScreenShareStart);
      window.removeEventListener('screen_share_stop', handleScreenShareStop);
      window.removeEventListener('open_screen_share', handleOpenScreenShare);
      window.removeEventListener('voice_channel_leave', handleVoiceChannelLeave);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [selectedUser]);

  // Проверка здоровья видео потока
  useEffect(() => {
    if (isScreenShareVisible && selectedUser) {
      // Запускаем проверку каждые 3 секунды
      const healthInterval = setInterval(checkVideoHealth, 3000);
      setVideoHealthCheck(healthInterval);
      
      return () => {
        if (healthInterval) {
          clearInterval(healthInterval);
        }
        setVideoHealthCheck(null);
      };
    } else {
      // Останавливаем проверку если демонстрация не активна
      if (videoHealthCheck) {
        clearInterval(videoHealthCheck);
        setVideoHealthCheck(null);
      }
    }
  }, [isScreenShareVisible, selectedUser]);

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
    
    // Дополнительная очистка контейнера
    const videoContainer = document.getElementById('screen-share-container-chat');
    if (videoContainer) {
      videoContainer.innerHTML = '';
      console.log('🖥️ Очищен контейнер при закрытии демонстрации');
    }
  };

  const toggleFullscreen = () => {
    const screenShareContainer = document.querySelector('.screen-share-fullscreen-container');
    if (!screenShareContainer) return;

    if (!isFullscreen) {
      screenShareContainer.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  // Функция для проверки здоровья видео потока
  const checkVideoHealth = () => {
    if (!selectedUser) return;
    
    console.log(`🖥️ ChatArea: Проверка здоровья видео для пользователя ${selectedUser}`);
    
    const videoElement = document.getElementById(`remote-video-${selectedUser}`) as HTMLVideoElement;
    if (videoElement) {
      // Проверяем, есть ли активный поток
      const stream = videoElement.srcObject as MediaStream;
      if (stream) {
        const videoTracks = stream.getVideoTracks();
        const hasActiveTrack = videoTracks.some(track => track.readyState === 'live');
        
        console.log(`🖥️ ChatArea: Состояние видео потока для ${selectedUser}:`, {
          hasStream: !!stream,
          tracksCount: videoTracks.length,
          hasActiveTrack,
          trackStates: videoTracks.map(t => ({ id: t.id, readyState: t.readyState, enabled: t.enabled }))
        });
        
        if (!hasActiveTrack) {
          console.log('🖥️ ChatArea: Обнаружен неактивный видео поток, но НЕ удаляем сразу');
          
          // Даем время на восстановление соединения
          setTimeout(() => {
            const recheckVideoElement = document.getElementById(`remote-video-${selectedUser}`) as HTMLVideoElement;
            if (recheckVideoElement) {
              const recheckStream = recheckVideoElement.srcObject as MediaStream;
              if (recheckStream) {
                const recheckVideoTracks = recheckStream.getVideoTracks();
                const recheckHasActiveTrack = recheckVideoTracks.some(track => track.readyState === 'live');
                
                if (!recheckHasActiveTrack) {
                  console.log('🖥️ ChatArea: Поток все еще неактивен после повторной проверки, удаляем');
                  
                  // Удаляем пользователя из списка стримеров
                  setSharingUsers(prev => {
                    const newUsers = prev.filter(u => u.userId !== selectedUser);
                    console.log(`🖥️ ChatArea: Удаляем неактивного стримера ${selectedUser}, остались:`, newUsers);
                    
                    if (newUsers.length > 0) {
                      console.log(`🖥️ ChatArea: Переключаемся на ${newUsers[0].userId}`);
                      setSelectedUser(newUsers[0].userId);
                    } else {
                      console.log('🖥️ ChatArea: Никого не осталось, закрываем');
                      setIsScreenShareVisible(false);
                      setSelectedUser(null);
                      const videoContainer = document.getElementById('screen-share-container-chat');
                      if (videoContainer) {
                        videoContainer.innerHTML = '';
                        console.log('🖥️ Очищен контейнер - неактивный поток');
                      }
                    }
                    return newUsers;
                  });
                  
                  // Удаляем видео элемент
                  recheckVideoElement.remove();
                } else {
                  console.log('🖥️ ChatArea: Поток восстановился после повторной проверки');
                }
              }
            }
          }, 2000); // Ждем 2 секунды перед удалением
        }
      } else {
        console.log(`🖥️ ChatArea: Нет потока для видео элемента ${selectedUser}`);
        
        // Проверяем, есть ли этот пользователь в списке активных стримеров
        const isUserStillStreaming = sharingUsers.some(u => u.userId === selectedUser);
        if (!isUserStillStreaming) {
          console.log(`🖥️ ChatArea: Пользователь ${selectedUser} больше не стримит, удаляем видео элемент`);
          videoElement.remove();
        } else {
          console.log(`🖥️ ChatArea: Пользователь ${selectedUser} все еще должен стримить, ждем восстановления потока`);
        }
      }
    } else {
      console.log(`🖥️ ChatArea: Видео элемент не найден для пользователя ${selectedUser}`);
      
      // Проверяем, есть ли этот пользователь в списке активных стримеров
      const isUserStillStreaming = sharingUsers.some(u => u.userId === selectedUser);
      if (isUserStillStreaming) {
        console.log(`🖥️ ChatArea: Пользователь ${selectedUser} должен стримить, но видео элемент отсутствует - возможно, еще создается`);
        
        // Попробуем найти видео элемент в другом месте DOM
        const lostVideo = document.querySelector(`video[id="remote-video-${selectedUser}"]`) as HTMLVideoElement;
        if (lostVideo) {
          console.log(`🖥️ ChatArea: Найден потерянный видео элемент для ${selectedUser}, восстанавливаем`);
          const videoContainer = document.getElementById('screen-share-container-chat');
          if (videoContainer && !videoContainer.contains(lostVideo)) {
            // Скрываем все видео
            Array.from(videoContainer.children).forEach(child => {
              if (child instanceof HTMLVideoElement) {
                child.style.display = 'none';
              }
            });
            // Добавляем найденное видео
            videoContainer.appendChild(lostVideo);
            lostVideo.style.display = 'block';
            console.log(`🖥️ ChatArea: Восстановлен видео элемент ${lostVideo.id}`);
          }
        }
      }
    }
  };

  // Переключение видео при смене выбранного пользователя
  useEffect(() => {
    if (selectedUser && isScreenShareVisible) {
      console.log(`🖥️ ChatArea: Попытка переключения на пользователя ${selectedUser}`);
      
      const videoContainer = document.getElementById('screen-share-container-chat');
      const selectedVideo = document.getElementById(`remote-video-${selectedUser}`);
      
      console.log('🖥️ ChatArea: Состояние элементов:', {
        videoContainer: !!videoContainer,
        selectedVideo: !!selectedVideo,
        selectedUserId: selectedUser,
        containerChildren: videoContainer ? Array.from(videoContainer.children).map(c => c.id) : [],
        allVideosInDocument: Array.from(document.querySelectorAll('[id^="remote-video-"]')).map(v => ({
          id: v.id,
          display: (v as HTMLElement).style.display,
          parent: v.parentElement?.id || 'no-parent',
          srcObject: !!(v as HTMLVideoElement).srcObject
        }))
      });
      
      if (videoContainer) {
        // Скрываем все видео элементы
        Array.from(videoContainer.children).forEach(child => {
          if (child instanceof HTMLVideoElement) {
            child.style.display = 'none';
            console.log(`🖥️ ChatArea: Скрыто видео ${child.id}`);
          }
        });
        
        if (selectedVideo) {
          // Показываем только выбранное видео
          selectedVideo.style.display = 'block';
          
          // Если видео не в контейнере, добавляем его
          if (!videoContainer.contains(selectedVideo)) {
            videoContainer.appendChild(selectedVideo);
            console.log(`🖥️ ChatArea: Добавлено видео ${selectedVideo.id} в контейнер`);
          }
          
          console.log(`🖥️ ChatArea: Переключено отображение на пользователя ${selectedUser}`);
          
          // Дополнительная проверка через 500мс
          setTimeout(() => {
            const checkVideo = document.getElementById(`remote-video-${selectedUser}`) as HTMLVideoElement;
            if (checkVideo) {
              console.log(`🖥️ ChatArea: Проверка видео через 500мс:`, {
                id: checkVideo.id,
                display: checkVideo.style.display,
                readyState: checkVideo.readyState,
                srcObject: !!checkVideo.srcObject,
                videoWidth: checkVideo.videoWidth,
                videoHeight: checkVideo.videoHeight,
                parent: checkVideo.parentElement?.id
              });
            }
          }, 500);
        } else {
          console.log(`🖥️ ChatArea: Видео элемент для пользователя ${selectedUser} не найден!`);
          
          // Попробуем найти видео во всем документе
          const allVideos = document.querySelectorAll(`video[id^="remote-video-"]`);
          console.log('🖥️ ChatArea: Все видео элементы в документе:', Array.from(allVideos).map(v => ({
            id: v.id,
            display: (v as HTMLElement).style.display,
            parent: v.parentElement?.id || 'no-parent',
            srcObject: !!(v as HTMLVideoElement).srcObject
          })));
          
          // Ждем появления видео элемента
          const waitForVideo = (attempts = 0) => {
            const video = document.getElementById(`remote-video-${selectedUser}`);
            if (video && videoContainer) {
              console.log(`🖥️ ChatArea: Найдено видео после ожидания: ${video.id}`);
              // Скрываем все видео
              Array.from(videoContainer.children).forEach(child => {
                if (child instanceof HTMLVideoElement) {
                  child.style.display = 'none';
                }
              });
              // Показываем нужное
              video.style.display = 'block';
              if (!videoContainer.contains(video)) {
                videoContainer.appendChild(video);
              }
            } else if (attempts < 15) { // Увеличиваем количество попыток
              console.log(`🖥️ ChatArea: Ожидание видео ${selectedUser}, попытка ${attempts + 1}/15`);
              setTimeout(() => waitForVideo(attempts + 1), 200);
            } else {
              console.error(`🖥️ ChatArea: Не удалось найти видео для пользователя ${selectedUser} после ожидания`);
              
              // Попробуем найти любое доступное видео
              const anyVideo = document.querySelector('[id^="remote-video-"]') as HTMLVideoElement;
              if (anyVideo && videoContainer) {
                console.log('🖥️ ChatArea: Используем любое доступное видео:', anyVideo.id);
                anyVideo.style.display = 'block';
                if (!videoContainer.contains(anyVideo)) {
                  videoContainer.appendChild(anyVideo);
                }
              }
            }
          };
          waitForVideo();
        }
      }
    }
  }, [selectedUser, isScreenShareVisible]);

  // Отладка состояния (только при изменениях)
  useEffect(() => {
    console.log('🖥️ ChatArea состояние изменилось:', {
      isScreenShareVisible,
      sharingUsersLength: sharingUsers.length,
      sharingUsers,
      selectedUser,
      shouldShowScreenShare: isScreenShareVisible && sharingUsers.length > 0
    });
  }, [isScreenShareVisible, sharingUsers.length, selectedUser]);

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

      {/* Screen Share Area - занимает всё пространство чата */}
      {isScreenShareVisible && sharingUsers.length > 0 && (
        <div className="flex-1 bg-gray-900 flex flex-col screen-share-fullscreen-container">
          {/* Заголовок демонстрации */}
          <div className="flex items-center justify-between px-4 py-2 bg-gray-800/90 backdrop-blur-sm border-b border-gray-700 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-400 font-semibold text-sm uppercase tracking-wide">В ЭФИРЕ</span>
              </div>
              <div className="w-px h-4 bg-gray-600" />
              <Monitor className="w-4 h-4 text-green-400 flex-shrink-0" />
              <span className="text-white font-medium text-sm truncate">
                {sharingUsers.find(u => u.userId === selectedUser)?.username === 'Вы' 
                  ? 'Ваша демонстрация экрана' 
                  : `Смотрите: ${sharingUsers.find(u => u.userId === selectedUser)?.username}`}
              </span>
            </div>
            
            <div className="flex items-center gap-2">

              
              {/* Кнопка звука */}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleMute}
                className={cn(
                  "w-8 h-8 p-0 transition-all duration-200",
                  isMuted 
                    ? "text-red-400 hover:text-red-300 hover:bg-red-400/20" 
                    : "text-gray-300 hover:text-white hover:bg-gray-700"
                )}
                title={isMuted ? 'Включить звук' : 'Отключить звук'}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </Button>
              
              {/* Кнопка остановить демонстрацию - только если я сам стримлю */}
              {isScreenSharing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={stopScreenShare}
                  className="flex items-center gap-2 text-sm px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                  title="Остановить мою демонстрацию экрана"
                >
                  <MonitorOff className="w-4 h-4" />
                  Остановить мой стрим
                </Button>
              )}
              
              {/* Кнопка развернуть */}
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleFullscreen}
                className="w-8 h-8 p-0 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
                title={isFullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
              
              {/* Кнопка закрытия */}
              <Button
                variant="ghost"
                size="sm"
                onClick={closeScreenShare}
                className="w-8 h-8 p-0 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
                title="Закрыть демонстрацию"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Область для видео - занимает всё оставшееся пространство */}
          <div className="flex-1 relative bg-black">
            <div 
              id="screen-share-container-chat" 
              className="absolute inset-0 bg-black"
            >
              {/* Видео элементы будут добавлены сюда через VoiceService */}
              {/* Показываем заглушку если нет активного видео */}
              {sharingUsers.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-white">
                  <div className="text-center">
                    <div className="text-6xl mb-4">📺</div>
                    <div className="text-xl mb-2">Демонстрация экрана завершена</div>
                    <div className="text-gray-400">Стример отключился или остановил демонстрацию</div>
                  </div>
                </div>
              )}
            </div>

            {/* Информационная панель внизу */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pointer-events-none">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                      <span className="text-white text-sm font-semibold">
                        {sharingUsers.find(u => u.userId === selectedUser)?.username[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="text-white font-medium text-sm">
                        {sharingUsers.find(u => u.userId === selectedUser)?.username === 'Вы' 
                          ? 'Вы' 
                          : sharingUsers.find(u => u.userId === selectedUser)?.username}
                      </div>
                      <div className="text-gray-400 text-xs flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                        {sharingUsers.find(u => u.userId === selectedUser)?.username === 'Вы' 
                          ? 'Демонстрируете экран' 
                          : 'Демонстрирует экран'}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {/* Счетчик зрителей */}
                  <div className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-md">
                    <div className="w-2 h-2 bg-gray-400 rounded-full" />
                    <span className="text-gray-300 text-xs">
                      {sharingUsers.length} {sharingUsers.length === 1 ? 'стример' : 'стримера'}
                    </span>
                  </div>
                  
                  {/* Качество */}
                  <div className="bg-black/40 px-2 py-1 rounded-md">
                    <span className="text-gray-300 text-xs">HD</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages Area - скрываем когда показывается демонстрация экрана */}
      {!(isScreenShareVisible && sharingUsers.length > 0) && (
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
      )}

      {/* Message Input - скрываем когда показывается демонстрация экрана */}
      {currentChannel.type === 'text' && !(isScreenShareVisible && sharingUsers.length > 0) && (
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