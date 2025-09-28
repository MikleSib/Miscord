import { audioProcessingService } from './audioProcessingService';
import soundService from './soundService';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://stream-cash.ru';

console.log('🎙️ VoiceService инициализирован с WS_URL:', WS_URL);

// Глобальная переменная для отслеживания экземпляра
declare global {
  interface Window {
    __voiceServiceInstance?: VoiceService;
  }
}

interface PeerConnection {
  pc: RTCPeerConnection;
  userId: number;
}

class VoiceService {
  private ws: WebSocket | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null; // Поток демонстрации экрана
  private peerConnections: Map<number, PeerConnection> = new Map();
  private iceServers: RTCIceServer[] = [];
  private voiceChannelId: number | null = null;
  private token: string | null = null;
  private onParticipantJoined: ((participant: any) => void) | null = null;
  private onParticipantLeft: ((userId: number) => void) | null = null;
  private onSpeakingChanged: ((userId: number, isSpeaking: boolean) => void) | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: number | null = null;
  private isSpeaking: boolean = false;
  private speakingUsers: Set<number> = new Set();
  private onParticipantsReceivedCallback: ((participants: any[]) => void) | null = null;
  private onParticipantStatusChangedCallback: ((userId: number, status: Partial<{ is_muted: boolean; is_deafened: boolean }>) => void) | null = null;
  private isScreenSharing: boolean = false; // Статус демонстрации экрана
  private onScreenShareChanged: ((userId: number, isSharing: boolean) => void) | null = null;

  // Методы для уведомлений о разрешении аудио
  showAudioPermissionNotification(userId: number): void {
    // Удаляем существующее уведомление если есть
    this.hideAudioPermissionNotification();
    
    const notification = document.createElement('div');
    notification.id = 'audio-permission-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff6b6b;
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 300px;
      cursor: pointer;
    `;
    notification.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">🔊 Разрешите воспроизведение аудио</div>
      <div style="font-size: 12px; opacity: 0.9;">Кликните в любом месте для включения звука от других участников</div>
    `;
    
    // Добавляем обработчик клика
    notification.addEventListener('click', () => {
      console.log('🔊 Пользователь кликнул на уведомление о разрешении аудио');
      this.hideAudioPermissionNotification();
    });
    
    document.body.appendChild(notification);
    
    // Автоматически скрываем через 10 секунд
    setTimeout(() => {
      this.hideAudioPermissionNotification();
    }, 10000);
  }

  hideAudioPermissionNotification(): void {
    const notification = document.getElementById('audio-permission-notification');
    if (notification) {
      notification.remove();
    }
  }

  async connect(voiceChannelId: number, token: string) {
    console.log('🎙️ VoiceService.connect вызван с параметрами:', { voiceChannelId, token: token ? 'есть' : 'нет' });
    
    // Проверяем, не подключены ли мы уже к этому каналу
    if (this.voiceChannelId === voiceChannelId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🎙️ Уже подключены к этому каналу, пропускаем переподключение');
      return;
    }
    
    // Если есть активное WebSocket соединение, сначала закрываем его
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('🎙️ Обнаружено активное WebSocket соединение, закрываем перед новым подключением');
      this.disconnect();
      // Ждём немного для завершения закрытия
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Если подключены к другому каналу или соединение закрыто, сначала очищаем
    if (this.ws || this.voiceChannelId) {
      console.log('🎙️ Очищаем предыдущее соединение перед новым подключением');
      this.cleanup();
    }
    
    this.voiceChannelId = voiceChannelId;
    this.token = token;

    // Получаем доступ к микрофону
    try {
      console.log('🎙️ Запрашиваем доступ к микрофону...');
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      console.log('🎙️ Доступ к микрофону получен');
      
      // Применяем обработку аудио с VAD и шумоподавлением
      console.log('🎙️ Инициализируем обработку аудио (VAD + шумоподавление)...');
      this.localStream = await audioProcessingService.initialize(rawStream);
      
      // Настраиваем callbacks для VAD
      audioProcessingService.setOnSpeechStart(() => {
        console.log('🎙️ VAD: Речь началась');
        this.sendMessage({
          type: 'speaking',
          is_speaking: true
        });
      });
      
      audioProcessingService.setOnSpeechEnd(() => {
        console.log('🎙️ VAD: Речь закончилась');
        this.sendMessage({
          type: 'speaking',
          is_speaking: false
        });
      });
      
      audioProcessingService.setOnVolumeChange((volume) => {
        // Можно использовать для визуализации уровня громкости
        if (volume > 0.1) {
          // Временно, пока не интегрируем полностью VAD
          this.initVoiceActivityDetection();
        }
      });
      
      // Анализируем громкость для визуализации
      audioProcessingService.analyzeVolume(this.localStream);
      
      // Инициализируем старую детекцию голосовой активности (временно)
      this.initVoiceActivityDetection();
    } catch (error) {
      console.error('🎙️ Ошибка доступа к микрофону:', error);
      throw new Error('Не удалось получить доступ к микрофону');
    }

    // Подключаемся к WebSocket
    const wsUrl = `${WS_URL}/ws/voice/${voiceChannelId}?token=${token}`;
    console.log('🎙️ Подключаемся к WebSocket:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => {
        console.log('🎙️ Voice WebSocket подключен успешно');
        resolve();
      };

      this.ws!.onerror = (error) => {
        console.error('🎙️ Ошибка Voice WebSocket:', error);
        reject(new Error('Ошибка подключения WebSocket'));
      };

      this.ws!.onmessage = async (event) => {
        console.log('🎙️ Получено сообщение WebSocket:', event.data);
        const data = JSON.parse(event.data);
        await this.handleMessage(data);
      };

      this.ws!.onclose = (event) => {
        console.log('🎙️ Voice WebSocket отключен:', event.code, event.reason);
        console.log('🎙️ WebSocket readyState после закрытия:', (event.target as WebSocket)?.readyState);
        // Не вызываем cleanup() здесь, чтобы избежать рекурсии
        // cleanup() должен вызываться только при явном отключении пользователем
      };
    });
  }

  private async handleMessage(data: any) {
    console.log('🔊 VoiceService получил сообщение:', data.type, data);
    
    switch (data.type) {
      case 'participants':
        this.iceServers = data.ice_servers;
        console.log('🔊 ICE серверы:', this.iceServers);
        
        // Передаем список участников в store
        if (this.onParticipantsReceivedCallback) {
          this.onParticipantsReceivedCallback(data.participants);
        }
        
        // Создаем соединения с существующими участниками (кроме себя)
        const currentUserId = this.getCurrentUserId();
        for (const participant of data.participants) {
          if (participant.user_id !== currentUserId) {
            console.log('🔊 Создаем peer connection с участником:', participant.user_id, participant.username);
            // Создаем offer только если наш ID меньше
            const shouldCreateOffer = currentUserId !== null && currentUserId < participant.user_id;
            await this.createPeerConnection(participant.user_id, shouldCreateOffer);
          }
        }
        break;

      case 'user_joined_voice':
        console.log('🔊 Пользователь присоединился к голосовому каналу:', data.user_id, data.username);
        
        // Воспроизводим звук подключения
        soundService.playJoinSound();
        
        if (this.onParticipantJoined) {
          this.onParticipantJoined({
            user_id: data.user_id,
            username: data.username,
            display_name: data.display_name,
            avatar_url: data.avatar_url
          });
        }
        // Создаем соединение только если это не мы сами
        const currentUserId2 = this.getCurrentUserId();
        if (data.user_id !== currentUserId2) {
          // Создаем offer только если наш ID меньше (существующий пользователь создает offer для нового)
          const shouldCreateOffer = currentUserId2 !== null && currentUserId2 < data.user_id;
          await this.createPeerConnection(data.user_id, shouldCreateOffer);
        }
        break;

      case 'user_left_voice':
        console.log('🔊 Пользователь покинул голосовой канал:', data.user_id);
        
        // Воспроизводим звук отключения
        soundService.playLeaveSound();
        
        if (this.onParticipantLeft) {
          this.onParticipantLeft(data.user_id);
        }
        this.removePeerConnection(data.user_id);
        break;

      case 'offer':
        console.log('🔊 Получен offer от пользователя:', data.from_id);
        await this.handleOffer(data.from_id, data.offer);
        break;

      case 'answer':
        console.log('🔊 Получен answer от пользователя:', data.from_id);
        await this.handleAnswer(data.from_id, data.answer);
        break;

      case 'ice_candidate':
        console.log('🔊 Получен ICE candidate от пользователя:', data.from_id);
        await this.handleIceCandidate(data.from_id, data.candidate);
        break;
        
      case 'user_speaking':
        // Обработка информации о том, что пользователь говорит
        if (this.onSpeakingChanged) {
          this.onSpeakingChanged(data.user_id, data.is_speaking);
        }
        break;
        
      case 'user_muted':
        // Обработка изменения статуса микрофона
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, { is_muted: data.is_muted });
        }
        break;
        
      case 'user_deafened':
        // Обработка изменения статуса наушников
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, { is_deafened: data.is_deafened });
        }
        break;

      case 'participant_status_changed':
        console.log('🔊 Статус участника изменен:', data.user_id, data.status);
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, data.status);
        }
        break;

      case 'screen_share_started':
        console.log('🖥️ Пользователь начал демонстрацию экрана:', data.user_id);
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, true);
        }
        break;

      case 'screen_share_stopped':
        console.log('🖥️ Пользователь остановил демонстрацию экрана:', data.user_id);
        // Удаляем видео элемент
        const videoElement = document.getElementById(`remote-video-${data.user_id}`);
        if (videoElement) {
          videoElement.remove();
        }
        
        // Скрываем контейнер если больше нет демонстраций экрана
        const videoContainer = document.getElementById('screen-share-container-chat');
        if (videoContainer && videoContainer.children.length === 0) {
          videoContainer.style.display = 'none';
          console.log('🖥️ Контейнер скрыт, так как нет активных демонстраций экрана');
        }
        
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, false);
        }
        break;

      default:
        console.log('🔊 Неизвестное сообщение:', data);
    }
  }

  private async createPeerConnection(userId: number, createOffer: boolean) {
    console.log(`🔊 Создаем peer connection с пользователем ${userId}, createOffer: ${createOffer}`);
    console.log(`🔊 ICE серверы:`, this.iceServers);
    
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });
    
    // Добавляем обработчики событий для отладки
    pc.oniceconnectionstatechange = () => {
      console.log(`🔊 ICE connection state для пользователя ${userId}:`, pc.iceConnectionState);
    };
    
    pc.onicegatheringstatechange = () => {
      console.log(`🔊 ICE gathering state для пользователя ${userId}:`, pc.iceGatheringState);
    };
    
    pc.onconnectionstatechange = () => {
      console.log(`🔊 Connection state для пользователя ${userId}:`, pc.connectionState);
    };
    
    pc.onsignalingstatechange = () => {
      console.log(`🔊 Signaling state для пользователя ${userId}:`, pc.signalingState);
    };

    // Добавляем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        console.log(`🔊 Добавляем трек ${track.kind} в peer connection для пользователя ${userId}`);
        pc.addTrack(track, this.localStream!);
      });
    }

    // Обработка входящего потока
    pc.ontrack = (event) => {
      console.log('🔊 Получен удаленный поток от пользователя', userId, event.streams);
      
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();

        // Обрабатываем аудио треки
        if (audioTracks.length > 0) {
          console.log(`🔊 Обрабатываем ${audioTracks.length} аудио треков от пользователя ${userId}`);
          audioTracks.forEach((track, index) => {
            console.log(`🔊 Аудио трек ${index}:`, {
              id: track.id,
              kind: track.kind,
              enabled: track.enabled,
              muted: track.muted,
              readyState: track.readyState,
              settings: track.getSettings()
            });
          });
          
          const remoteAudio = new Audio();
          remoteAudio.srcObject = new MediaStream(audioTracks);
          remoteAudio.autoplay = true;
          remoteAudio.controls = false;
          remoteAudio.muted = false;
          remoteAudio.volume = 1.0;
          
          remoteAudio.id = `remote-audio-${userId}`;
          remoteAudio.style.display = 'none';
          document.body.appendChild(remoteAudio);
          
          // Применяем сохраненную громкость если есть
          setTimeout(() => {
            const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
            if (savedVolume) {
              const volume = parseInt(savedVolume);
              remoteAudio.volume = Math.min(volume / 100, 3.0);
              console.log(`🔊 Применена сохраненная громкость ${volume}% для пользователя ${userId}`);
            }
          }, 100);
          
          // Пытаемся воспроизвести аудио
          const playPromise = remoteAudio.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log('🔊 Аудио от пользователя', userId, 'успешно воспроизводится');
            }).catch(error => {
              console.error('🔊 Ошибка воспроизведения аудио от пользователя', userId, ':', error);
              
              // Показываем уведомление пользователю о необходимости разрешить аудио
              this.showAudioPermissionNotification(userId);
              
              const enableAudio = () => {
                remoteAudio.play().then(() => {
                  console.log('🔊 Аудио от пользователя', userId, 'включено после взаимодействия пользователя');
                  this.hideAudioPermissionNotification();
                  document.removeEventListener('click', enableAudio);
                  document.removeEventListener('touchstart', enableAudio);
                  document.removeEventListener('keydown', enableAudio);
                }).catch(e => {
                  console.error('🔊 Все еще не удается воспроизвести аудио от пользователя', userId, ':', e);
                });
              };
              
              // Добавляем больше событий для активации аудио
              document.addEventListener('click', enableAudio, { once: true });
              document.addEventListener('touchstart', enableAudio, { once: true });
              document.addEventListener('keydown', enableAudio, { once: true });
              
              // Также пытаемся активировать через пользовательские жесты
              setTimeout(() => {
                if (remoteAudio.paused) {
                  console.log('🔊 Пытаемся активировать аудио через программный клик');
                  document.body.click();
                }
              }, 1000);
            });
          }
        }

        // Обрабатываем видео треки (демонстрация экрана)
        if (videoTracks.length > 0) {
          console.log('🖥️ Получен видео поток от пользователя', userId);
          
          // Создаем или обновляем видео элемент
          let remoteVideo = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement;
          if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = `remote-video-${userId}`;
            remoteVideo.autoplay = true;
            remoteVideo.controls = false;
            remoteVideo.muted = true; // Видео всегда без звука, звук идет через аудио элемент
            remoteVideo.style.position = 'absolute';
            remoteVideo.style.top = '0';
            remoteVideo.style.left = '0';
            remoteVideo.style.width = '100%';
            remoteVideo.style.height = '100%';
          remoteVideo.style.objectFit = 'contain';
            remoteVideo.style.backgroundColor = '#000';
          // Запрашиваем 60fps при воспроизведении где поддерживается
          try {
            // @ts-ignore
            remoteVideo.playbackRate = 1.0;
          } catch {}
            
            // Добавляем обработчик загрузки видео
            remoteVideo.addEventListener('loadeddata', () => {
              console.log(`🖥️ Видео загружено для пользователя ${userId}`);
            });
            
            remoteVideo.addEventListener('error', (e) => {
              console.error(`🖥️ Ошибка загрузки видео для пользователя ${userId}:`, e);
            });
            
            // Ждем появления контейнера в ChatArea для удалённого видео
            const waitForRemoteContainer = (attempts = 0): void => {
              const videoContainer = document.getElementById('screen-share-container-chat');
              
              if (videoContainer) {
                // Контейнер найден, показываем его и добавляем видео
                videoContainer.style.display = 'flex';
                videoContainer.innerHTML = '';
                videoContainer.appendChild(remoteVideo);
                console.log(`🖥️ Видео элемент добавлен в ChatArea для пользователя ${userId}. Контейнер размеры:`, {
                  width: videoContainer.offsetWidth,
                  height: videoContainer.offsetHeight,
                  style: videoContainer.style.cssText
                });
              } else if (attempts < 50) { // Максимум 5 секунд
                // Контейнер ещё не создан, ждем
                console.log(`🖥️ Ожидание контейнера для пользователя ${userId} (попытка ${attempts + 1}/50)`);
                setTimeout(() => waitForRemoteContainer(attempts + 1), 100);
              } else {
                // Превышено время ожидания
                console.error(`🖥️ Превышено время ожидания контейнера для пользователя ${userId}`);
                remoteVideo.remove();
                return;
              }
            };
            
            waitForRemoteContainer();
          }
          
          remoteVideo.srcObject = new MediaStream(videoTracks);
          
          // Уведомляем о начале демонстрации экрана
          if (this.onScreenShareChanged) {
            this.onScreenShareChanged(userId, true);
          }
          
          console.log('🖥️ Видео элемент создан для пользователя', userId);
        }
      }
    };

    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`🔊 Отправляем ICE candidate пользователю ${userId}:`, event.candidate);
        this.sendMessage({
          type: 'ice_candidate',
          target_id: userId,
          candidate: event.candidate,
        });
      }
    };

    // Обработка состояния соединения
    pc.onconnectionstatechange = () => {
      console.log(`🔊 Состояние соединения с пользователем ${userId}:`, pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`🔊 Состояние ICE соединения с пользователем ${userId}:`, pc.iceConnectionState);
    };

    this.peerConnections.set(userId, { pc, userId });

    if (createOffer) {
      console.log(`🔊 Создаем offer для пользователя ${userId}`);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log(`🔊 Отправляем offer пользователю ${userId}:`, offer);
      this.sendMessage({
        type: 'offer',
        target_id: userId,
        offer: offer,
      });
    }
  }

  private async handleOffer(userId: number, offer: RTCSessionDescriptionInit) {
    console.log(`🔊 Обрабатываем offer от пользователя ${userId}:`, offer);
    
    let peerConnection = this.peerConnections.get(userId);
    
    if (!peerConnection) {
      console.log(`🔊 Создаем новое peer connection для пользователя ${userId}`);
      await this.createPeerConnection(userId, false);
      peerConnection = this.peerConnections.get(userId)!;
    }

    try {
      await peerConnection.pc.setRemoteDescription(offer);
      console.log(`🔊 Установлен remote description для пользователя ${userId}`);
      
      const answer = await peerConnection.pc.createAnswer();
      await peerConnection.pc.setLocalDescription(answer);
      console.log(`🔊 Создан и установлен answer для пользователя ${userId}:`, answer);

      this.sendMessage({
        type: 'answer',
        target_id: userId,
        answer: answer,
      });
      console.log(`🔊 Отправлен answer пользователю ${userId}`);
    } catch (error) {
      console.error(`🔊 Ошибка при обработке offer от пользователя ${userId}:`, error);
    }
  }

  private async handleAnswer(userId: number, answer: RTCSessionDescriptionInit) {
    console.log(`🔊 Обрабатываем answer от пользователя ${userId}:`, answer);
    
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      try {
        await peerConnection.pc.setRemoteDescription(answer);
        console.log(`🔊 Установлен remote description (answer) для пользователя ${userId}`);
      } catch (error) {
        console.error(`🔊 Ошибка при обработке answer от пользователя ${userId}:`, error);
      }
    } else {
      console.error(`🔊 Не найдено peer connection для пользователя ${userId}`);
    }
  }

  private async handleIceCandidate(userId: number, candidate: RTCIceCandidateInit) {
    console.log(`🔊 Обрабатываем ICE candidate от пользователя ${userId}:`, candidate);
    
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      try {
        await peerConnection.pc.addIceCandidate(candidate);
        console.log(`🔊 Добавлен ICE candidate для пользователя ${userId}`);
      } catch (error) {
        console.error(`🔊 Ошибка при добавлении ICE candidate для пользователя ${userId}:`, error);
      }
    } else {
      console.error(`🔊 Не найдено peer connection для пользователя ${userId}`);
    }
  }

  private removePeerConnection(userId: number) {
    console.log(`🔊 Удаляем peer connection для пользователя ${userId}`);
    
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      peerConnection.pc.close();
      this.peerConnections.delete(userId);
    }
    
    // Удаляем аудио элемент из DOM
    const audioElement = document.getElementById(`remote-audio-${userId}`);
    if (audioElement) {
      audioElement.remove();
      console.log(`🔊 Удален аудио элемент для пользователя ${userId}`);
    }

    // Удаляем видео элемент из DOM
    const videoElement = document.getElementById(`remote-video-${userId}`);
    if (videoElement) {
      videoElement.remove();
      console.log(`🖥️ Удален видео элемент для пользователя ${userId}`);
      
      // Уведомляем об остановке демонстрации экрана
      if (this.onScreenShareChanged) {
        this.onScreenShareChanged(userId, false);
      }
    }
  }

  private sendMessage(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  setMuted(muted: boolean) {
    // Используем audio processing service для управления mute
    audioProcessingService.setMuted(muted);
    
    // Также отключаем треки на уровне WebRTC для двойной защиты
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
    
    // Отправляем сообщение на сервер
    this.sendMessage({ type: 'mute', is_muted: muted });
    
    console.log(`🎙️ Микрофон ${muted ? 'заглушен' : 'включен'} (обработка через audio pipeline + WebRTC)`);
  }

  setDeafened(deafened: boolean) {
    console.log(`🔊 Установка deafened: ${deafened}`);
    
    // Заглушаем/включаем все удаленные аудио элементы
    this.peerConnections.forEach(({ userId }) => {
      const audioElement = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement;
      if (audioElement) {
        audioElement.muted = deafened;
        console.log(`🔊 ${deafened ? 'Заглушен' : 'Включен'} звук от пользователя ${userId}`);
      }
    });
    
    // Отправляем статус на сервер
    this.sendMessage({ type: 'deafen', is_deafened: deafened });
  }

  onParticipantJoin(callback: (participant: any) => void) {
    this.onParticipantJoined = callback;
  }

  onParticipantLeave(callback: (userId: number) => void) {
    this.onParticipantLeft = callback;
  }

  disconnect() {
    console.log('🎙️ VoiceService.disconnect вызван');
    console.log('🎙️ Текущее состояние ws:', this.ws ? this.ws.readyState : 'null');
    console.log('🎙️ Текущий voiceChannelId:', this.voiceChannelId);
    
    // Сохраняем ссылку на WebSocket для закрытия
    const wsToClose = this.ws;
    
    // Вызываем cleanup
    this.cleanup();
    
    // Дополнительная проверка - если WebSocket всё ещё существует
    if (wsToClose && wsToClose.readyState !== WebSocket.CLOSED) {
      console.warn('🎙️ WebSocket не закрылся после cleanup, пробуем ещё раз');
      try {
        wsToClose.close();
      } catch (e) {
        console.error('🎙️ Ошибка при дополнительном закрытии:', e);
      }
    }
  }

  private cleanup() {
    console.log('🔊 Очистка VoiceService');
    
    // Очищаем аудио обработку
    audioProcessingService.destroy();
    
    // Очищаем все обработчики событий
    this.onParticipantJoined = null;
    this.onParticipantLeft = null;
    this.onSpeakingChanged = null;
    this.onParticipantsReceivedCallback = null;
    this.onParticipantStatusChangedCallback = null;
    this.onScreenShareChanged = null;
    
    // Закрываем все peer connections
    this.peerConnections.forEach(({ pc, userId }) => {
      pc.close();
      // Удаляем соответствующий аудио элемент
      const audioElement = document.getElementById(`remote-audio-${userId}`);
      if (audioElement) {
        audioElement.remove();
      }
      // Удаляем соответствующий видео элемент
      const videoElement = document.getElementById(`remote-video-${userId}`);
      if (videoElement) {
        videoElement.remove();
        console.log(`🖥️ Удален видео элемент для пользователя ${userId} при cleanup`);
      }
    });
    this.peerConnections.clear();

    // Останавливаем потоки демонстрации экрана
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    this.isScreenSharing = false;

    // Очищаем все видео элементы из контейнера
    const videoContainer = document.getElementById('screen-share-container-chat');
    if (videoContainer) {
      videoContainer.innerHTML = '';
      console.log('🖥️ Очищен контейнер screen-share-container-chat');
    }

    // Удаляем все возможные видео элементы которые могли остаться
    document.querySelectorAll('video[id^="remote-video-"]').forEach(video => {
      video.remove();
      console.log('🖥️ Удален остаточный видео элемент:', video.id);
    });

    // Останавливаем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Очищаем VAD
    this.cleanupVoiceActivityDetection();

    // Закрываем WebSocket если открыт
    if (this.ws) {
      console.log('🔊 Закрываем WebSocket соединение. Текущее состояние:', this.ws.readyState);
      
      const wsToClose = this.ws;
      
      // Сразу обнуляем ссылку, чтобы предотвратить повторное использование
      this.ws = null;
      
      // Удаляем обработчики событий
      wsToClose.onopen = null;
      wsToClose.onmessage = null;
      wsToClose.onerror = null;
      wsToClose.onclose = null;
      
      // Закрываем соединение
      try {
        console.log('🔊 Вызываем ws.close()...');
        wsToClose.close(1000, 'User disconnected');
        console.log('🔊 ws.close() вызван успешно');
        
        // Проверяем состояние через 100мс
        setTimeout(() => {
          console.log('🔊 Состояние WebSocket через 100мс:', wsToClose.readyState);
          if (wsToClose.readyState !== WebSocket.CLOSED) {
            console.warn('🔊 WebSocket всё ещё не закрыт, пытаемся закрыть принудительно');
            try {
              wsToClose.close();
            } catch (e) {
              console.error('🔊 Ошибка при повторном закрытии:', e);
            }
          }
        }, 100);
      } catch (error) {
        console.error('🔊 Ошибка при закрытии WebSocket:', error);
      }
    }

    this.voiceChannelId = null;
    this.token = null;
  }

  // Методы для детекции голосовой активности
  private initVoiceActivityDetection() {
    if (!this.localStream) return;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      
      // Настройки для максимальной чувствительности
      this.analyser.fftSize = 1024; // Увеличиваем для лучшего разрешения
      this.analyser.minDecibels = -100; // Понижаем для захвата тихих звуков
      this.analyser.maxDecibels = -10;
      this.analyser.smoothingTimeConstant = 0.3; // Уменьшаем для более быстрой реакции
      
      source.connect(this.analyser);
      
      this.startVoiceActivityDetection();
    } catch (error) {
      console.error('🎙️ Ошибка инициализации VAD:', error);
    }
  }

  private startVoiceActivityDetection() {
    if (!this.analyser || !this.audioContext) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.vadInterval = window.setInterval(() => {
      if (!this.analyser || !this.audioContext || this.audioContext.state === 'closed') {
        return;
      }
      
      try {
        this.analyser.getByteFrequencyData(dataArray);
        
        // Анализируем разные частотные диапазоны
        const lowFreqEnd = Math.floor(bufferLength * 0.1); // 0-10% частот (низкие)
        const midFreqStart = lowFreqEnd;
        const midFreqEnd = Math.floor(bufferLength * 0.4); // 10-40% частот (средние - человеческая речь)
        const highFreqStart = midFreqEnd;
        
        // Вычисляем энергию в разных диапазонах
        let lowSum = 0, midSum = 0, highSum = 0, totalSum = 0, maxValue = 0;
        
        for (let i = 0; i < bufferLength; i++) {
          const value = dataArray[i];
          totalSum += value;
          maxValue = Math.max(maxValue, value);
          
          if (i < lowFreqEnd) {
            lowSum += value;
          } else if (i < midFreqEnd) {
            midSum += value;
          } else {
            highSum += value;
          }
        }
        
        const totalAverage = totalSum / bufferLength;
        const midAverage = midSum / (midFreqEnd - midFreqStart);
        
        // Очень низкие пороги для максимальной чувствительности
        const totalThreshold = 3; // Общий порог
        const midThreshold = 5; // Порог для средних частот (речь)
        const maxThreshold = 8; // Порог для пиковых значений
        
        // Считаем что говорим если превышен любой из порогов
        const currentlySpeaking = 
          totalAverage > totalThreshold || 
          midAverage > midThreshold || 
          maxValue > maxThreshold;
        
        if (currentlySpeaking !== this.isSpeaking) {
          this.isSpeaking = currentlySpeaking;
          
          console.log(`🎙️ Голосовая активность: ${currentlySpeaking ? 'ГОВОРИТ' : 'молчит'} (total: ${totalAverage.toFixed(1)}, mid: ${midAverage.toFixed(1)}, max: ${maxValue})`);
          
          // Отправляем информацию о голосовой активности
          this.sendMessage({
            type: 'speaking',
            is_speaking: currentlySpeaking
          });
          
          // Уведомляем UI
          if (this.onSpeakingChanged) {
            // Для локального пользователя используем ID из токена
            const currentUserId = this.getCurrentUserId();
            if (currentUserId) {
              this.onSpeakingChanged(currentUserId, currentlySpeaking);
            }
          }
        }
      } catch (error) {
        console.error('🎙️ Ошибка при анализе голосовой активности:', error);
      }
    }, 50); // Проверяем каждые 50мс (было 100мс) для более быстрой реакции
  }

  private getCurrentUserId(): number | null {
    if (!this.token) return null;
    
    try {
      const payload = JSON.parse(atob(this.token.split('.')[1]));
      return parseInt(payload.sub);
    } catch {
      return null;
    }
  }

  private cleanupVoiceActivityDetection() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.isSpeaking = false;
    this.speakingUsers.clear();
  }

  onSpeakingChange(callback: (userId: number, isSpeaking: boolean) => void) {
    this.onSpeakingChanged = callback;
  }

  onParticipantsReceived(callback: (participants: any[]) => void) {
    this.onParticipantsReceivedCallback = callback;
  }

  onParticipantStatusChanged(callback: (userId: number, status: Partial<{ is_muted: boolean; is_deafened: boolean }>) => void) {
    this.onParticipantStatusChangedCallback = callback;
  }

  // Демонстрация экрана
  async startScreenShare(): Promise<boolean> {
    try {
      console.log('🖥️ Начинаем демонстрацию экрана');
      
      // Проверяем, не демонстрирует ли пользователь уже экран
      if (this.isScreenSharing) {
        console.log('🖥️ Пользователь уже демонстрирует экран');
        return false;
      }
      
      // Получаем поток экрана
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 60, max: 60 }
        },
        audio: true // Включаем звук системы если доступен
      });

      // Обрабатываем событие остановки демонстрации экрана
      this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        console.log('🖥️ Демонстрация экрана остановлена пользователем');
        this.stopScreenShare();
      });

      // Обрабатываем событие остановки аудио трека
      const audioTracks = this.screenStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].addEventListener('ended', () => {
          console.log('🖥️ Системный звук остановлен');
        });
      }

      // Добавляем видео трек ко всем существующим peer connections
      const updatePromises: Promise<void>[] = [];
      
      this.peerConnections.forEach(({ pc }, userId) => {
        const updatePromise = this.updatePeerConnectionForScreenShare(pc, userId);
        updatePromises.push(updatePromise);
      });

      // Ждем завершения всех обновлений
      try {
        await Promise.allSettled(updatePromises);
        console.log('🖥️ Все peer connections обновлены для демонстрации экрана');
      } catch (error) {
        console.error('🖥️ Ошибка при обновлении peer connections:', error);
      }

      // Создаем локальный видео элемент для стримера
      this.createLocalScreenShareVideo();

      this.isScreenSharing = true;
      
      // Уведомляем сервер о начале демонстрации экрана
      this.sendMessage({ 
        type: 'screen_share_start'
      });

      // Отправляем локальное событие для обновления UI
      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
        // Получаем имя пользователя из токена или используем "Вы"
        let username = 'Вы';
        try {
          if (this.token) {
            const payload = JSON.parse(atob(this.token.split('.')[1]));
            username = payload.username || 'Вы';
          }
        } catch (error) {
          console.warn('Не удалось получить имя пользователя из токена:', error);
        }
        
        const event = new CustomEvent('screen_share_start', {
          detail: { 
            user_id: currentUserId,
            username: username
          }
        });
        window.dispatchEvent(event);
        console.log('🖥️ Отправлено локальное событие screen_share_start для пользователя:', currentUserId);
      }

      console.log('🖥️ Демонстрация экрана успешно начата');
      return true;
    } catch (error) {
      console.error('🖥️ Ошибка начала демонстрации экрана:', error);
      return false;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    console.log('🖥️ Останавливаем демонстрацию экрана');

    // Отправляем локальное событие для немедленного обновления UI
    const userId = this.getCurrentUserId();
    if (userId) {
      const event = new CustomEvent('screen_share_stop', {
        detail: { 
          user_id: userId
        }
      });
      window.dispatchEvent(event);
      console.log('🖥️ Отправлено локальное событие screen_share_stop для пользователя:', userId);
    }

    // Останавливаем все треки
    this.screenStream.getTracks().forEach(track => {
      track.stop();
    });

    // Удаляем видео и системные аудио треки из всех peer connections
    const removePromises: Promise<void>[] = [];
    
    this.peerConnections.forEach(({ pc }, userId) => {
      const removePromise = this.removeScreenShareFromPeerConnection(pc, userId);
      removePromises.push(removePromise);
    });

    // Ждем завершения всех операций удаления
    Promise.allSettled(removePromises).then(() => {
      console.log('🖥️ Все peer connections обновлены после остановки демонстрации экрана');
    }).catch(error => {
      console.error('🖥️ Ошибка при обновлении peer connections:', error);
    });

    this.screenStream = null;
    this.isScreenSharing = false;

    // Удаляем локальный видео элемент
    const currentUserId = this.getCurrentUserId();
    if (currentUserId) {
      const localVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
      if (localVideo) {
        localVideo.remove();
        console.log('🖥️ Локальный видео элемент удален');
      }

      // Уведомляем об остановке демонстрации экрана для локального пользователя
      if (this.onScreenShareChanged) {
        this.onScreenShareChanged(currentUserId, false);
      }

      // Отправляем глобальное событие
      const event = new CustomEvent('screen_share_stop', {
        detail: { 
          user_id: currentUserId
        }
      });
      window.dispatchEvent(event);
    }

    // Уведомляем сервер об остановке демонстрации экрана
    this.sendMessage({ 
      type: 'screen_share_stop'
    });

    console.log('🖥️ Демонстрация экрана остановлена');
  }

  // Вспомогательный метод для удаления screen share из peer connection
  private async removeScreenShareFromPeerConnection(pc: RTCPeerConnection, userId: number): Promise<void> {
    try {
      const senders = pc.getSenders();
      
      // Удаляем видео треки и системные аудио треки
      const removePromises: Promise<void>[] = [];
      
      senders.forEach((sender: RTCRtpSender) => {
        if (sender.track) {
          const track = sender.track;
          
          // Удаляем видео треки
          if (track.kind === 'video') {
            const removePromise = sender.replaceTrack(null).then(() => {
              console.log(`🖥️ Видео трек остановлен для пользователя ${userId}`);
            }).catch(error => {
              console.error(`🖥️ Ошибка остановки видео трека для пользователя ${userId}:`, error);
              // Если replaceTrack не работает, удаляем трек
              try {
                pc.removeTrack(sender);
                console.log(`🖥️ Видео трек удален альтернативным способом для пользователя ${userId}`);
              } catch (removeError) {
                console.error(`🖥️ Ошибка удаления видео трека для пользователя ${userId}:`, removeError);
              }
            });
            removePromises.push(removePromise);
          }
          
          // Удаляем системные аудио треки
          if (track.kind === 'audio' && (
            track.label.includes('System') || 
            track.label.includes('Desktop') ||
            track.label.includes('Entire')
          )) {
            const removePromise = sender.replaceTrack(null).then(() => {
              console.log(`🖥️ Системный аудио трек остановлен для пользователя ${userId}`);
            }).catch(error => {
              console.error(`🖥️ Ошибка остановки системного аудио трека для пользователя ${userId}:`, error);
              // Если replaceTrack не работает, удаляем трек
              try {
                pc.removeTrack(sender);
                console.log(`🖥️ Системный аудио трек удален альтернативным способом для пользователя ${userId}`);
              } catch (removeError) {
                console.error(`🖥️ Ошибка удаления системного аудио трека для пользователя ${userId}:`, removeError);
              }
            });
            removePromises.push(removePromise);
          }
        }
      });

      // Ждем завершения всех операций удаления треков
      await Promise.allSettled(removePromises);

      // Создаем новый offer без screen share только если connection активно
      if (pc.connectionState === 'connected' || pc.connectionState === 'new') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendMessage({
          type: 'offer',
          target_id: userId,
          offer: offer,
        });
        console.log(`🖥️ Отправлен offer без screen share для пользователя ${userId}`);
      } else {
        console.warn(`🖥️ Peer connection для пользователя ${userId} не готов для создания offer. Состояние: ${pc.connectionState}`);
      }
    } catch (error) {
      console.error(`🖥️ Ошибка при остановке демонстрации для пользователя ${userId}:`, error);
      throw error;
    }
  }

  getScreenSharingStatus(): boolean {
    return this.isScreenSharing;
  }

  onScreenShareChange(callback: (userId: number, isSharing: boolean) => void) {
    this.onScreenShareChanged = callback;
  }

  // Вспомогательный метод для обновления peer connection для демонстрации экрана
  private async updatePeerConnectionForScreenShare(pc: RTCPeerConnection, userId: number): Promise<void> {
    try {
      if (!this.screenStream) {
        console.error('🖥️ screenStream не доступен для обновления peer connection');
        return;
      }

      const videoTrack = this.screenStream.getVideoTracks()[0];
      const audioTracks = this.screenStream.getAudioTracks();
      
      if (!videoTrack) {
        console.error('🖥️ Видео трек не найден в screenStream');
        return;
      }

      // Получаем все senders
      const senders = pc.getSenders();
      const existingVideoSender = senders.find(sender => 
        sender.track && sender.track.kind === 'video'
      );
      const existingAudioSenders = senders.filter(sender => 
        sender.track && sender.track.kind === 'audio'
      );

      // Обновляем видео трек
      if (existingVideoSender) {
        // Заменяем существующий видео трек
        await existingVideoSender.replaceTrack(videoTrack);
        console.log(`🖥️ Заменен видео трек для пользователя ${userId}`);
      } else {
        // Добавляем новый видео трек
        pc.addTrack(videoTrack, this.screenStream);
        console.log(`🖥️ Добавлен видео трек для пользователя ${userId}`);
      }

      // Настраиваем приоритет и битрейт для видео экрана
      try {
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          const parameters = videoSender.getParameters();
          if (parameters.encodings && parameters.encodings.length > 0) {
            parameters.encodings[0].maxBitrate = 5_000_000; // до ~5 Mbps для 1080p60
            parameters.encodings[0].maxFramerate = 60;
            await videoSender.setParameters(parameters);
          }
        }
      } catch (e) {
        console.warn('🖥️ Не удалось настроить параметры отправки видео:', e);
      }

      // Подсказка контента для улучшения качества движения
      try {
        // contentHint поддерживается в современных браузерах
        // @ts-ignore
        videoTrack.contentHint = 'motion';
      } catch {}

      // Обрабатываем системный аудио трек
      if (audioTracks.length > 0) {
        const systemAudioTrack = audioTracks[0];
        
        // Проверяем, что это действительно системный звук
        const isSystemAudio = systemAudioTrack.label.includes('System') || 
                             systemAudioTrack.label.includes('Desktop') ||
                             systemAudioTrack.label.includes('Entire') ||
                             systemAudioTrack.getSettings().deviceId !== 'default';
        
        if (isSystemAudio) {
          // Ищем существующий системный аудио sender
          const existingSystemAudioSender = existingAudioSenders.find(sender => {
            const track = sender.track;
            return track && track.kind === 'audio' && (
              track.label.includes('System') || 
              track.label.includes('Desktop') ||
              track.label.includes('Entire')
            );
          });

          if (existingSystemAudioSender) {
            // Заменяем существующий системный аудио трек
            await existingSystemAudioSender.replaceTrack(systemAudioTrack);
            console.log(`🖥️ Заменен системный аудио трек для пользователя ${userId}`);
          } else {
            // Добавляем новый системный аудио трек
            pc.addTrack(systemAudioTrack, this.screenStream);
            console.log(`🖥️ Добавлен системный аудио трек для пользователя ${userId}`);
          }
        }
      }

      // Создаем новый offer только если connection state позволяет
      if (pc.connectionState === 'connected' || pc.connectionState === 'new') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendMessage({
          type: 'offer',
          target_id: userId,
          offer: offer,
        });
        console.log(`🖥️ Отправлен offer с видео треком для пользователя ${userId}`);
      } else {
        console.warn(`🖥️ Peer connection для пользователя ${userId} не готов для создания offer. Состояние: ${pc.connectionState}`);
      }
    } catch (error) {
      console.error(`🖥️ Ошибка обновления peer connection для пользователя ${userId}:`, error);
      throw error;
    }
  }

  private createLocalScreenShareVideo() {
    if (!this.screenStream) return;

    console.log('🖥️ Создаем локальный видео элемент для стримера');

    // Получаем текущего пользователя
    const currentUserId = this.getCurrentUserId();
    if (!currentUserId) return;

    // Удаляем существующий локальный видео элемент если есть
    const existingVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
    if (existingVideo) {
      existingVideo.remove();
    }

    // Создаем новый видео элемент
    const localVideo = document.createElement('video');
    localVideo.id = `remote-video-${currentUserId}`;
    localVideo.autoplay = true;
    localVideo.controls = false;
    localVideo.muted = true; // Заглушаем чтобы избежать эха
    localVideo.style.position = 'absolute';
    localVideo.style.top = '0';
    localVideo.style.left = '0';
    localVideo.style.width = '100%';
    localVideo.style.height = '100%';
    localVideo.style.objectFit = 'contain';
    localVideo.style.backgroundColor = '#000';
    
    // Добавляем обработчики событий
    localVideo.addEventListener('loadeddata', () => {
      console.log('🖥️ Локальное видео загружено');
    });
    
    localVideo.addEventListener('error', (e) => {
      console.error('🖥️ Ошибка загрузки локального видео:', e);
    });
    
    // Устанавливаем поток
    localVideo.srcObject = this.screenStream;
    
    // Ждем появления контейнера в ChatArea (максимум 5 секунд)
    const waitForContainer = (attempts = 0): void => {
      const videoContainer = document.getElementById('screen-share-container-chat');
      
      if (videoContainer) {
        // Контейнер найден, добавляем видео
        videoContainer.innerHTML = '';
        videoContainer.appendChild(localVideo);
        console.log('🖥️ Локальный видео элемент добавлен в ChatArea. Контейнер размеры:', {
          width: videoContainer.offsetWidth,
          height: videoContainer.offsetHeight,
          style: videoContainer.style.cssText,
          videoSrc: localVideo.srcObject ? 'есть' : 'нет'
        });
        
        // Проверяем, что видео элемент действительно добавлен
        setTimeout(() => {
          const addedVideo = document.getElementById(`remote-video-${currentUserId}`);
          if (addedVideo) {
            console.log('🖥️ Видео элемент найден в DOM через 1 секунду:', {
              width: addedVideo.offsetWidth,
              height: addedVideo.offsetHeight,
              readyState: (addedVideo as HTMLVideoElement).readyState,
              videoWidth: (addedVideo as HTMLVideoElement).videoWidth,
              videoHeight: (addedVideo as HTMLVideoElement).videoHeight
            });
          }
        }, 1000);
      } else if (attempts < 50) { // Максимум 5 секунд (50 * 100ms)
        // Контейнер ещё не создан, ждем
        console.log(`🖥️ Ожидание контейнера screen-share-container-chat (попытка ${attempts + 1}/50)`);
        setTimeout(() => waitForContainer(attempts + 1), 100);
      } else {
        // Превышено время ожидания
        console.error('🖥️ Превышено время ожидания контейнера screen-share-container-chat');
        localVideo.remove();
        return;
      }
    };
    
    waitForContainer();

    // Уведомляем о начале демонстрации экрана для локального пользователя
    if (this.onScreenShareChanged) {
      this.onScreenShareChanged(currentUserId, true);
    }
  }
}

// Проверяем, есть ли уже экземпляр
if (typeof window !== 'undefined' && window.__voiceServiceInstance) {
  console.log('🎙️ Используем существующий экземпляр VoiceService');
  // Закрываем старое соединение если есть
  window.__voiceServiceInstance.disconnect();
} else {
  console.log('🎙️ Создаём новый экземпляр VoiceService');
}

const voiceServiceInstance = new VoiceService();

// Сохраняем экземпляр глобально
if (typeof window !== 'undefined') {
  window.__voiceServiceInstance = voiceServiceInstance;
  
  // Закрываем соединение при закрытии страницы
  window.addEventListener('beforeunload', () => {
    console.log('🎙️ Страница закрывается, отключаем голосовое соединение');
    voiceServiceInstance.disconnect();
  });
  
  // Также обрабатываем скрытие страницы
  window.addEventListener('pagehide', () => {
    console.log('🎙️ Страница скрывается, отключаем голосовое соединение');
    voiceServiceInstance.disconnect();
  });
}


export default voiceServiceInstance;