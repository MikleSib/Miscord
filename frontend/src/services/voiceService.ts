import noiseSuppressionService from './noiseSuppressionService';
import { useNoiseSuppressionStore } from '@/store/noiseSuppressionStore';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

console.log('🎙️ VoiceService инициализирован с WS_URL:', WS_URL);

interface PeerConnection {
  pc: RTCPeerConnection;
  userId: number;
}

class VoiceService {
  private ws: WebSocket | null = null;
  private localStream: MediaStream | null = null;
  private rawStream: MediaStream | null = null; // Сырой поток для VAD
  private screenStream: MediaStream | null = null; // Поток демонстрации экрана
  private peerConnections: Map<number, PeerConnection> = new Map();
  private iceServers: RTCIceServer[] = [];
  private voiceChannelId: number | null = null;
  private token: string | null = null;
  private onParticipantJoined: ((userId: number, username: string) => void) | null = null;
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
  private isManuallyMuted: boolean = false;
  private isDisconnecting: boolean = false; // Флаг намеренного отключения
  private audioDataLogging: boolean = false; // Флаг для включения логирования аудио данных
  private audioMetrics: {
    bytesSent: number;
    bytesReceived: number;
    packetsLost: number;
    roundTripTime: number;
    lastUpdate: number;
  } = {
    bytesSent: 0,
    bytesReceived: 0,
    packetsLost: 0,
    roundTripTime: 0,
    lastUpdate: Date.now()
  };

  // Включение/выключение детального логирования аудио
  enableAudioDataLogging(enable: boolean = true) {
    this.audioDataLogging = enable;
    console.log(`🎙️ ${enable ? 'Включено' : 'Выключено'} детальное логирование аудио данных`);
  }

  async connect(voiceChannelId: number, token: string) {
    console.log('🎙️ VoiceService.connect вызван с параметрами:', { voiceChannelId, token: token ? 'есть' : 'нет' });
    
    if (this.voiceChannelId === voiceChannelId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🎙️ Уже подключены к этому каналу, пропускаем переподключение');
      return;
    }
    
    if (this.ws || this.voiceChannelId) {
      console.log('🎙️ Очищаем предыдущее соединение перед новым подключением');
      await this.cleanup();
    }
    
    this.voiceChannelId = voiceChannelId;
    this.token = token;
    this.isDisconnecting = false;

    try {
      console.log('🎙️ Запрашиваем доступ к микрофону...');
      this.rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // Отключаем браузерные фильтры
          noiseSuppression: false,  // Используем только наш кастомный шумодав
          autoGainControl: false,   // Отключаем автоматическую регулировку громкости
          sampleRate: 48000, 
        },
        video: false,
      });
      console.log('🎙️ Доступ к микрофону получен');
      
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('🔇 AudioContext создан для шумодава');
      }
      
      await noiseSuppressionService.initialize(this.audioContext);
      
      const noiseSettings = noiseSuppressionService.getSettings();
      console.log('🔇 Настройки шумодава после инициализации:', noiseSettings);
      
      this.localStream = await noiseSuppressionService.processStream(this.rawStream);
      console.log('🔇 Поток обработан через сервис шумодава');
      
      if (this.localStream !== this.rawStream) {
        console.log('🔇 ✅ Шумодав успешно применен к потоку');
      } else {
        console.warn('🔇 ⚠️ Шумодав не был применен, используется оригинальный поток');
      }
      
      this.initVoiceActivityDetection();
    } catch (error) {
      console.error('🎙️ Ошибка доступа к микрофону:', error);
      throw new Error('Не удалось получить доступ к микрофону');
    }

    const wsUrl = `${WS_URL}/ws/voice/${voiceChannelId}?token=${token}`;
    console.log('🎙️ Подключаемся к Voice WebSocket:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket не создан'));
        return;
      }

      this.ws.onopen = () => {
        console.log('🎙️ Voice WebSocket подключен успешно');
        this.isDisconnecting = false;
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error('🎙️ Ошибка Voice WebSocket:', error);
        reject(new Error('Ошибка подключения WebSocket'));
      };

      this.ws.onmessage = async (event) => {
        if (this.audioDataLogging) {
          console.log('🎙️ 📩 Получено сообщение Voice WebSocket:', {
            data: event.data,
            timestamp: new Date().toISOString(),
            size: event.data.length
          });
        } else {
          console.log('🎙️ Получено сообщение Voice WebSocket (тип):', JSON.parse(event.data).type);
        }
        const data = JSON.parse(event.data);
        await this.handleMessage(data);
      };

      this.ws.onclose = (event) => {
        console.log('🎙️ Voice WebSocket отключен:', { 
          code: event.code, 
          reason: event.reason,
          wasClean: event.wasClean,
          isDisconnecting: this.isDisconnecting 
        });
        
        if (!this.isDisconnecting) {
          console.warn('🎙️ ⚠️ Неожиданное отключение Voice WebSocket');
        }
        
        this.cleanup();
      };
    });
  }

  private async handleMessage(data: any) {
    if (this.audioDataLogging) {
      console.log('🔊 VoiceService получил сообщение (детально):', {
        type: data.type,
        data: data,
        timestamp: new Date().toISOString(),
        messageSize: JSON.stringify(data).length
      });
    } else {
      console.log('🔊 VoiceService получил сообщение:', data.type);
    }
    
    switch (data.type) {
      case 'participants':
        this.iceServers = data.ice_servers;
        console.log('🔊 ICE серверы получены:', this.iceServers);
        
        if (this.onParticipantsReceivedCallback) {
          this.onParticipantsReceivedCallback(data.participants);
        }
        
        const currentUserId = this.getCurrentUserId();
        for (const participant of data.participants) {
          if (participant.user_id !== currentUserId) {
            console.log('🔊 Создаем peer connection с участником:', participant.user_id, participant.username);
            const shouldCreateOffer = currentUserId !== null && currentUserId < participant.user_id;
            await this.createPeerConnection(participant.user_id, shouldCreateOffer);
          }
        }
        break;

      case 'user_joined_voice':
        console.log('🔊 Пользователь присоединился к голосовому каналу:', data.user_id, data.username);
        if (this.onParticipantJoined) {
          this.onParticipantJoined(data.user_id, data.username);
        }
        const currentUserId2 = this.getCurrentUserId();
        if (data.user_id !== currentUserId2) {
          const shouldCreateOffer = currentUserId2 !== null && currentUserId2 < data.user_id;
          await this.createPeerConnection(data.user_id, shouldCreateOffer);
        }
        break;

      case 'user_left_voice':
        console.log('🔊 Пользователь покинул голосовой канал:', data.user_id);
        if (this.onParticipantLeft) {
          this.onParticipantLeft(data.user_id);
        }
        this.removePeerConnection(data.user_id);
        break;

      case 'offer':
        if (this.audioDataLogging) {
          console.log('🔊 📥 Получен offer от пользователя (детально):', {
            from_id: data.from_id,
            offer: data.offer,
            timestamp: new Date().toISOString()
          });
        } else {
          console.log('🔊 Получен offer от пользователя:', data.from_id);
        }
        await this.handleOffer(data.from_id, data.offer);
        break;

      case 'answer':
        if (this.audioDataLogging) {
          console.log('🔊 📥 Получен answer от пользователя (детально):', {
            from_id: data.from_id,
            answer: data.answer,
            timestamp: new Date().toISOString()
          });
        } else {
          console.log('🔊 Получен answer от пользователя:', data.from_id);
        }
        await this.handleAnswer(data.from_id, data.answer);
        break;

      case 'ice_candidate':
        if (this.audioDataLogging) {
          console.log('🔊 📥 Получен ICE candidate от пользователя (детально):', {
            from_id: data.from_id,
            candidate: data.candidate,
            timestamp: new Date().toISOString()
          });
        } else {
          console.log('🔊 Получен ICE candidate от пользователя:', data.from_id);
        }
        await this.handleIceCandidate(data.from_id, data.candidate);
        break;
        
      case 'user_speaking':
        // Ignore server speaking messages for the local user - we handle that locally with VAD
        const localUserId = this.getCurrentUserId();
        if (data.user_id === localUserId) {
          if (this.audioDataLogging) {
            console.log('🔊 Игнорируем серверное сообщение о голосовой активности для локального пользователя');
          }
          break;
        }
        
        if (this.audioDataLogging) {
          console.log('🔊 🗣️ Изменение голосовой активности пользователя:', {
            user_id: data.user_id,
            is_speaking: data.is_speaking,
            timestamp: new Date().toISOString()
          });
        }
        
        if (this.onSpeakingChanged) {
          this.onSpeakingChanged(data.user_id, data.is_speaking);
        }
        break;
        
      case 'user_muted':
        console.log('🔊 🔇 Пользователь изменил статус микрофона:', data.user_id, 'muted:', data.is_muted);
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, { is_muted: data.is_muted });
        }
        break;
        
      case 'user_deafened':
        console.log('🔊 🔇 Пользователь изменил статус наушников:', data.user_id, 'deafened:', data.is_deafened);
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
        window.dispatchEvent(new CustomEvent('screen_share_start', { 
          detail: { 
            user_id: data.user_id, 
            username: data.username || `User ${data.user_id}` 
          } 
        }));
        break;

      case 'screen_share_stopped':
        console.log('🖥️ Пользователь остановил демонстрацию экрана:', data.user_id);
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, false);
        }
        window.dispatchEvent(new CustomEvent('screen_share_stop', { 
          detail: { 
            user_id: data.user_id, 
            username: data.username || `User ${data.user_id}` 
          } 
        }));
        break;

      default:
        console.log('🔊 ❓ Неизвестное сообщение:', data);
    }
  }

  private async createPeerConnection(userId: number, createOffer: boolean) {
    console.log(`🔊 Создаем peer connection с пользователем ${userId}, createOffer: ${createOffer}`);
    
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Добавляем логирование статистики WebRTC соединения
    if (this.audioDataLogging) {
      const statsInterval = setInterval(async () => {
        if (pc.connectionState === 'connected') {
          try {
            const stats = await pc.getStats();
            this.logWebRTCStats(userId, stats);
          } catch (error) {
            console.error(`🔊 ❌ Ошибка получения статистики WebRTC для пользователя ${userId}:`, error);
          }
        } else if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          clearInterval(statsInterval);
        }
      }, 5000); // Каждые 5 секунд
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        console.log(`🔊 Добавляем трек ${track.kind} в peer connection для пользователя ${userId}`);
        const sender = pc.addTrack(track, this.localStream!);
        
        if (this.audioDataLogging && track.kind === 'audio') {
          console.log(`🔊 🎵 Добавлен аудио трек для пользователя ${userId}:`, {
            trackId: track.id,
            trackLabel: track.label,
            trackSettings: track.getSettings(),
            trackConstraints: track.getConstraints(),
            trackCapabilities: track.getCapabilities(),
            senderTransceiver: sender.track?.id
          });
        }
      });
    }

    pc.ontrack = (event) => {
      if (this.audioDataLogging) {
        console.log('🔊 📥 Получен удаленный поток от пользователя (детально):', userId, {
          streams: event.streams,
          track: {
            kind: event.track?.kind,
            id: event.track?.id,
            label: event.track?.label,
            readyState: event.track?.readyState,
            enabled: event.track?.enabled,
            muted: event.track?.muted,
            settings: event.track?.getSettings ? event.track.getSettings() : 'недоступно'
          },
          transceiver: {
            direction: event.transceiver?.direction,
            currentDirection: event.transceiver?.currentDirection,
            mid: event.transceiver?.mid
          },
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('🔊 Получен удаленный поток от пользователя', userId, {
          trackKind: event.track?.kind,
          trackId: event.track?.id,
          streams: event.streams?.length
        });
      }
      
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        
        console.log(`🔊 Анализ потока от пользователя ${userId}:`, {
          totalTracks: stream.getTracks().length,
          audioTracks: audioTracks.length,
          videoTracks: videoTracks.length,
          audioTrackIds: audioTracks.map(t => ({ id: t.id, label: t.label, readyState: t.readyState })),
          videoTrackIds: videoTracks.map(t => ({ id: t.id, label: t.label, readyState: t.readyState }))
        });

        if (audioTracks.length > 0) {
          this.setupRemoteAudio(userId, audioTracks);
        }

        if (videoTracks.length > 0) {
          this.setupRemoteVideo(userId, videoTracks);
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        if (this.audioDataLogging) {
          console.log(`🔊 📤 Отправляем ICE candidate пользователю ${userId} (детально):`, {
            candidate: event.candidate,
            timestamp: new Date().toISOString()
          });
        } else {
          console.log(`🔊 Отправляем ICE candidate пользователю ${userId}`);
        }
        this.sendMessage({
          type: 'ice_candidate',
          target_id: userId,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`🔊 Состояние соединения с пользователем ${userId}: ${pc.connectionState}`);
      
      if (pc.connectionState === 'connected') {
        console.log(`🔊 ✅ Успешно установлено соединение с пользователем ${userId}`);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log(`🔊 ❌ Соединение с пользователем ${userId} потеряно (${pc.connectionState})`);
        this.cleanupUserElements(userId);
        this.removePeerConnection(userId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`🔊 Состояние ICE соединения с пользователем ${userId}:`, pc.iceConnectionState);
      
      if (this.audioDataLogging) {
        console.log(`🔊 🧊 ICE детали для пользователя ${userId}:`, {
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          connectionState: pc.connectionState,
          signalingState: pc.signalingState,
          timestamp: new Date().toISOString()
        });
      }
    };

    this.peerConnections.set(userId, { pc, userId });

    if (createOffer) {
      try {
        console.log(`🔊 Создаем offer для пользователя ${userId}`);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        
        if (this.audioDataLogging) {
          console.log(`🔊 📤 Отправляем offer пользователю ${userId} (детально):`, {
            offer: offer,
            localDescription: pc.localDescription,
            timestamp: new Date().toISOString()
          });
        }
        
        this.sendMessage({
          type: 'offer',
          target_id: userId,
          offer: offer,
        });
      } catch (error) {
        console.error(`🔊 ❌ Ошибка создания offer для пользователя ${userId}:`, error);
      }
    }
  }

  // Новый метод для настройки удаленного аудио
  private setupRemoteAudio(userId: number, audioTracks: MediaStreamTrack[]) {
    console.log(`🔊 Настройка аудио воспроизведения для пользователя ${userId}`);
    
    // Удаляем старый аудио элемент если существует
    const existingAudio = document.getElementById(`remote-audio-${userId}`);
    if (existingAudio) {
      existingAudio.remove();
      console.log(`🔊 Удален старый аудио элемент для пользователя ${userId}`);
    }
    
    // Создаем новый аудио элемент
    const remoteAudio = document.createElement('audio');
    remoteAudio.id = `remote-audio-${userId}`;
    remoteAudio.autoplay = true;
    remoteAudio.controls = false;
    remoteAudio.muted = false;
    remoteAudio.volume = 1.0;
    remoteAudio.style.display = 'none';
    
    // Создаем MediaStream только с аудио треками
    const audioStream = new MediaStream(audioTracks);
    remoteAudio.srcObject = audioStream;
    
    // Добавляем элемент в DOM
    document.body.appendChild(remoteAudio);
    
    if (this.audioDataLogging) {
      // Детальные обработчики событий для диагностики
      remoteAudio.addEventListener('loadstart', () => {
        console.log(`🔊 📻 Начата загрузка аудио для пользователя ${userId} (${new Date().toISOString()})`);
      });
      
      remoteAudio.addEventListener('loadedmetadata', () => {
        console.log(`🔊 📻 Метаданные аудио загружены для пользователя ${userId}:`, {
          duration: remoteAudio.duration,
          readyState: remoteAudio.readyState,
          networkState: remoteAudio.networkState,
          volume: remoteAudio.volume,
          timestamp: new Date().toISOString()
        });
      });
      
      remoteAudio.addEventListener('canplay', () => {
        console.log(`🔊 📻 Аудио готово к воспроизведению для пользователя ${userId} (${new Date().toISOString()})`);
      });
      
      remoteAudio.addEventListener('error', (e) => {
        console.error(`🔊 ❌ Ошибка аудио элемента для пользователя ${userId}:`, e);
      });

      // Логируем изменения в аудио потоке
      audioTracks.forEach((track, index) => {
        track.addEventListener('ended', () => {
          console.log(`🔊 📻 Аудио трек ${index} завершен для пользователя ${userId}`);
        });
        
        track.addEventListener('mute', () => {
          console.log(`🔊 📻 Аудио трек ${index} заглушен для пользователя ${userId}`);
        });
        
        track.addEventListener('unmute', () => {
          console.log(`🔊 📻 Аудио трек ${index} включен для пользователя ${userId}`);
        });
      });
    }
    
    // Попытка воспроизведения
    this.attemptAudioPlay(remoteAudio, userId);
  }

  // Новый метод для попытки воспроизведения аудио
  private async attemptAudioPlay(remoteAudio: HTMLAudioElement, userId: number) {
    try {
      console.log(`🔊 Попытка воспроизведения аудио для пользователя ${userId}`);
      await remoteAudio.play();
      console.log(`🔊 ✅ Аудио от пользователя ${userId} успешно воспроизводится`);
      
      // Применяем сохраненную громкость
      const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
      if (savedVolume) {
        const volume = parseInt(savedVolume);
        remoteAudio.volume = Math.min(volume / 100, 1.0);
        console.log(`🔊 Применена сохраненная громкость ${volume}% для пользователя ${userId}`);
      }
      
    } catch (error) {
      console.warn(`🔊 ⚠️ Автовоспроизведение заблокировано для пользователя ${userId}:`, error);
      
      // Создаем обработчик для включения аудио после взаимодействия пользователя
      const enableAudio = async () => {
        try {
          await remoteAudio.play();
          console.log(`🔊 ✅ Аудио от пользователя ${userId} включено после взаимодействия пользователя`);
          
          // Удаляем обработчики после успешного воспроизведения
          document.removeEventListener('click', enableAudio);
          document.removeEventListener('touchstart', enableAudio);
          document.removeEventListener('keydown', enableAudio);
          
        } catch (e) {
          console.error(`🔊 ❌ Все еще не удается воспроизвести аудио от пользователя ${userId}:`, e);
        }
      };
      
      // Добавляем обработчики для различных типов взаимодействия
      document.addEventListener('click', enableAudio, { once: true });
      document.addEventListener('touchstart', enableAudio, { once: true });
      document.addEventListener('keydown', enableAudio, { once: true });
      
      // Показываем уведомление пользователю
      console.log(`🔊 💡 Кликните в любом месте страницы, чтобы включить звук от пользователя ${userId}`);
    }
  }

  // Новый метод для настройки удаленного видео
  private setupRemoteVideo(userId: number, videoTracks: MediaStreamTrack[]) {
    console.log('🖥️ Получен видео поток от пользователя', userId);
    
    let remoteVideo = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement;
    if (!remoteVideo) {
      remoteVideo = document.createElement('video');
      remoteVideo.id = `remote-video-${userId}`;
      remoteVideo.autoplay = true;
      remoteVideo.controls = false;
      remoteVideo.muted = true;
      remoteVideo.style.position = 'absolute';
      remoteVideo.style.top = '0';
      remoteVideo.style.left = '0';
      remoteVideo.style.width = '100%';
      remoteVideo.style.height = '100%';
      remoteVideo.style.objectFit = 'contain';
      remoteVideo.style.backgroundColor = '#000';
      
      if (this.audioDataLogging) {
        remoteVideo.addEventListener('loadeddata', () => {
          console.log(`🖥️ 📺 Видео загружено для пользователя ${userId} (${new Date().toISOString()})`);
        });
        
        remoteVideo.addEventListener('error', (e) => {
          console.error(`🖥️ ❌ Ошибка загрузки видео для пользователя ${userId}:`, e);
        });
      }
      
      this.waitForRemoteContainer(remoteVideo, userId);
    }
    
    remoteVideo.srcObject = new MediaStream(videoTracks);
    
    if (this.audioDataLogging) {
      remoteVideo.addEventListener('loadedmetadata', () => {
        console.log(`🖥️ 📺 Метаданные видео загружены для пользователя ${userId}:`, {
          videoWidth: remoteVideo.videoWidth,
          videoHeight: remoteVideo.videoHeight,
          readyState: remoteVideo.readyState,
          timestamp: new Date().toISOString()
        });
      });
      
      remoteVideo.addEventListener('canplay', () => {
        console.log(`🖥️ 📺 Видео готово к воспроизведению для пользователя ${userId} (${new Date().toISOString()})`);
      });
    }
    
    if (this.onScreenShareChanged) {
      this.onScreenShareChanged(userId, true);
    }
    
    console.log('🖥️ Видео элемент создан для пользователя', userId, {
      id: remoteVideo.id,
      srcObject: !!remoteVideo.srcObject,
      tracks: videoTracks.length
    });
  }

  // Новый метод ожидания контейнера для видео
  private waitForRemoteContainer(remoteVideo: HTMLVideoElement, userId: number, attempts = 0): void {
    const videoContainer = document.getElementById('screen-share-container-chat');
    
    if (videoContainer) {
      const existingVideo = document.getElementById(`remote-video-${userId}`);
      if (existingVideo && existingVideo !== remoteVideo) {
        existingVideo.remove();
        console.log(`🖥️ Удален старый видео элемент для пользователя ${userId}`);
      }
      
      if (!videoContainer.contains(remoteVideo)) {
        videoContainer.appendChild(remoteVideo);
        console.log(`🖥️ Видео элемент добавлен в ChatArea для пользователя ${userId}. Контейнер размеры:`, {
          width: videoContainer.offsetWidth,
          height: videoContainer.offsetHeight,
          style: videoContainer.style.cssText,
          childrenCount: videoContainer.children.length
        });
      }
    } else if (attempts < 50) {
      console.log(`🖥️ Ожидание контейнера для пользователя ${userId} (попытка ${attempts + 1}/50)`);
      setTimeout(() => this.waitForRemoteContainer(remoteVideo, userId, attempts + 1), 100);
    } else {
      console.error(`🖥️ Превышено время ожидания контейнера для пользователя ${userId}`);
      remoteVideo.remove();
      return;
    }
  }

  // Новый метод для очистки элементов пользователя
  private cleanupUserElements(userId: number) {
    const audioElement = document.getElementById(`remote-audio-${userId}`);
    if (audioElement) {
      audioElement.remove();
      console.log(`🔊 Удален аудио элемент для пользователя ${userId}`);
    }
    
    const videoElement = document.getElementById(`remote-video-${userId}`);
    if (videoElement) {
      videoElement.remove();
      console.log(`🖥️ Удален видео элемент для пользователя ${userId}`);
      
      window.dispatchEvent(new CustomEvent('screen_share_stop', { 
        detail: { 
          user_id: userId, 
          username: `User ${userId}` 
        } 
      }));
    }
  }

  // Новый метод для логирования WebRTC статистики
  private logWebRTCStats(userId: number, stats: RTCStatsReport) {
    let inboundAudio: any = null;
    let outboundAudio: any = null;
    let transport: any = null;

    stats.forEach((report: any) => {
      if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
        inboundAudio = report;
      } else if (report.type === 'outbound-rtp' && report.mediaType === 'audio') {
        outboundAudio = report;
      } else if (report.type === 'transport') {
        transport = report;
      }
    });

    console.log(`🔊 📊 WebRTC статистика для пользователя ${userId}:`, {
      timestamp: new Date().toISOString(),
      inbound: inboundAudio ? {
        bytesReceived: inboundAudio.bytesReceived,
        packetsReceived: inboundAudio.packetsReceived,
        packetsLost: inboundAudio.packetsLost,
        jitter: inboundAudio.jitter,
        audioLevel: inboundAudio.audioLevel
      } : 'недоступно',
      outbound: outboundAudio ? {
        bytesSent: outboundAudio.bytesSent,
        packetsSent: outboundAudio.packetsSent,
        retransmittedPacketsSent: outboundAudio.retransmittedPacketsSent
      } : 'недоступно',
      transport: transport ? {
        bytesSent: transport.bytesSent,
        bytesReceived: transport.bytesReceived,
        currentRoundTripTime: transport.currentRoundTripTime
      } : 'недоступно'
    });

    // Обновляем внутренние метрики
    if (outboundAudio) {
      this.audioMetrics.bytesSent = outboundAudio.bytesSent || 0;
    }
    if (inboundAudio) {
      this.audioMetrics.bytesReceived = inboundAudio.bytesReceived || 0;
      this.audioMetrics.packetsLost = inboundAudio.packetsLost || 0;
    }
    if (transport) {
      this.audioMetrics.roundTripTime = transport.currentRoundTripTime || 0;
    }
    this.audioMetrics.lastUpdate = Date.now();
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
    
    const audioElement = document.getElementById(`remote-audio-${userId}`);
    if (audioElement) {
      audioElement.remove();
      console.log(`🔊 Удален аудио элемент для пользователя ${userId}`);
    }

    const videoElement = document.getElementById(`remote-video-${userId}`);
    if (videoElement) {
      videoElement.remove();
      console.log(`🖥️ Удален видео элемент для пользователя ${userId}`);
      
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
    this.isManuallyMuted = muted;

    if (muted) {
        noiseSuppressionService.setGain(0);
    } else {
        // Let VAD decide the gain level, but we can set it to 1 initially
        // to avoid a delay in being heard when unmuting. VAD will correct on next tick if silent.
        noiseSuppressionService.setGain(1);
    }
    
    // If the user mutes, we should also ensure the speaking status is off.
    if (muted && this.isSpeaking) {
        this.isSpeaking = false;
        this.sendMessage({ type: 'speaking', is_speaking: false });
        const currentUserId = this.getCurrentUserId();
        if (currentUserId && this.onSpeakingChanged) {
          this.onSpeakingChanged(currentUserId, false);
        }
    }
    this.sendMessage({ type: 'mute', is_muted: muted });
  }

  setDeafened(deafened: boolean) {
    console.log(`🔊 Установка deafened: ${deafened}`);
    
    // Проходим по всем подключениям и управляем аудио элементами
    this.peerConnections.forEach(({ userId }) => {
      const audioElement = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement;
      if (audioElement) {
        audioElement.muted = deafened;
        console.log(`🔊 ${deafened ? 'Заглушен' : 'Включен'} звук от пользователя ${userId}`);
        
        // Дополнительная проверка состояния аудио элемента
        console.log(`🔊 Состояние аудио элемента пользователя ${userId}:`, {
          muted: audioElement.muted,
          volume: audioElement.volume,
          paused: audioElement.paused,
          readyState: audioElement.readyState,
          networkState: audioElement.networkState,
          srcObject: !!audioElement.srcObject
        });
        
        // Если включаем звук и элемент на паузе, пытаемся воспроизвести
        if (!deafened && audioElement.paused) {
          audioElement.play().catch(error => {
            console.warn(`🔊 Не удалось возобновить воспроизведение для пользователя ${userId}:`, error);
          });
        }
      } else {
        console.warn(`🔊 ⚠️ Аудио элемент для пользователя ${userId} не найден`);
      }
    });
    
    this.sendMessage({ type: 'deafen', is_deafened: deafened });
  }

  onParticipantJoin(callback: (userId: number, username: string) => void) {
    this.onParticipantJoined = callback;
  }

  onParticipantLeave(callback: (userId: number) => void) {
    this.onParticipantLeft = callback;
  }

  disconnect() {
    console.log('🎙️ Инициируем отключение от голосового канала');
    this.isDisconnecting = true;
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🎙️ Закрываем WebSocket соединение');
      this.ws.close(1000, 'Пользователь покинул канал');
    }
    
    this.cleanup();
  }

  private async cleanup() {
    console.log('🔊 Начинаем полную очистку VoiceService');
    
    // Останавливаем все peer connections
    this.peerConnections.forEach(({ pc, userId }) => {
      console.log(`🔊 Закрываем peer connection для пользователя ${userId}`);
      pc.close();
      this.cleanupUserElements(userId);
    });
    this.peerConnections.clear();

    // Останавливаем демонстрацию экрана
    if (this.screenStream) {
      console.log('🖥️ Останавливаем демонстрацию экрана при cleanup');
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    this.isScreenSharing = false;

    // Очищаем контейнеры видео
    const videoContainer = document.getElementById('screen-share-container-chat');
    if (videoContainer) {
      videoContainer.innerHTML = '';
      console.log('🖥️ Очищен контейнер screen-share-container-chat');
    }

    // Удаляем все оставшиеся видео элементы
    document.querySelectorAll('video[id^="remote-video-"]').forEach(video => {
      video.remove();
      console.log('🖥️ Удален остаточный видео элемент:', video.id);
    });

    // Удаляем все оставшиеся аудио элементы
    document.querySelectorAll('audio[id^="remote-audio-"]').forEach(audio => {
      audio.remove();
      console.log('🔊 Удален остаточный аудио элемент:', audio.id);
    });

    // Останавливаем локальные потоки
    if (this.localStream) {
      console.log('🎙️ Останавливаем локальный поток');
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log(`🎙️ Остановлен локальный трек: ${track.kind} (${track.label})`);
      });
      this.localStream = null;
    }

    if (this.rawStream) {
      console.log('🎙️ Останавливаем сырой поток');
      this.rawStream.getTracks().forEach(track => {
        track.stop();
        console.log(`🎙️ Остановлен сырой трек: ${track.kind} (${track.label})`);
      });
      this.rawStream = null;
    }

    // Очищаем голосовую активность
    this.cleanupVoiceActivityDetection();

    // Очищаем сервис шумодавления
    try {
      noiseSuppressionService.cleanup();
      console.log('🔇 Шумодав очищен');
    } catch (error) {
      console.warn('🔇 Ошибка при очистке шумодава:', error);
    }

    // Закрываем WebSocket если не закрыт
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        console.log('🎙️ Принудительно закрываем WebSocket при cleanup');
        this.ws.close(1000, 'Cleanup');
      }
      this.ws = null;
    }

    // Сбрасываем все состояния
    this.voiceChannelId = null;
    this.token = null;
    this.isDisconnecting = false;
    this.speakingUsers.clear();
    this.isSpeaking = false;
    this.isManuallyMuted = false;
    
    // Сбрасываем метрики
    this.audioMetrics = {
      bytesSent: 0,
      bytesReceived: 0,
      packetsLost: 0,
      roundTripTime: 0,
      lastUpdate: Date.now()
    };

    console.log('🔊 ✅ VoiceService полностью очищен');
  }

  private initVoiceActivityDetection() {
    if (!this.rawStream || !this.audioContext) return;

    try {
      // Используем сырой поток для VAD анализа, до обработки шумодавом
      const source = this.audioContext.createMediaStreamSource(this.rawStream);
      this.analyser = this.audioContext.createAnalyser();
      
      this.analyser.fftSize = 1024; 
      this.analyser.minDecibels = -100;
      this.analyser.maxDecibels = -10;
      this.analyser.smoothingTimeConstant = 0.3; 
      
      source.connect(this.analyser);
      
      console.log('🎙️ VAD инициализирован с анализером сырого потока');
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
        
        const { settings, setMicLevel } = useNoiseSuppressionStore.getState();

        const totalAverage = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const micLevelDb = 20 * Math.log10(totalAverage / 255);
        setMicLevel(isFinite(micLevelDb) ? micLevelDb : -100);

        if (this.isManuallyMuted) {
          return;
        }

        let currentlySpeaking;

        if (!settings.vadEnabled) {
          currentlySpeaking = true;
        } else {
          const dbThreshold = settings.vadThreshold;
          
          // Simply compare the actual mic level in dB with the user's threshold in dB
          currentlySpeaking = micLevelDb > dbThreshold;
        }

        noiseSuppressionService.setGain(currentlySpeaking ? 1 : 0);
        
        if (currentlySpeaking !== this.isSpeaking) {
          this.isSpeaking = currentlySpeaking;
          
        
          
          this.sendMessage({
            type: 'speaking',
            is_speaking: currentlySpeaking
          });
          
          if (this.onSpeakingChanged) {
            const currentUserId = this.getCurrentUserId();
            if (currentUserId) {
              this.onSpeakingChanged(currentUserId, currentlySpeaking);
            }
          }
        }
      } catch (error) {
        console.error('🎙️ Ошибка при анализе голосовой активности:', error);
      }
    }, 50);
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

  async startScreenShare(): Promise<boolean> {
    try {
      console.log('🖥️ Начинаем демонстрацию экрана');
      
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: true
      });

      this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        console.log('🖥️ Демонстрация экрана остановлена пользователем');
        this.stopScreenShare();
      });

      const audioTracks = this.screenStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].addEventListener('ended', () => {
          console.log('🖥️ Системный звук остановлен');
        });
      }

      console.log(`🖥️ Начинаем добавление видео треков к ${this.peerConnections.size} peer connections`);
      this.peerConnections.forEach(async ({ pc }, userId) => {
        try {
          console.log(`🖥️ Обрабатываем peer connection для пользователя ${userId}, состояние: ${pc.connectionState}`);
          const videoTrack = this.screenStream!.getVideoTracks()[0];
          if (videoTrack) {
            console.log(`🖥️ Видео трек найден:`, {
              id: videoTrack.id,
              label: videoTrack.label,
              readyState: videoTrack.readyState,
              enabled: videoTrack.enabled
            });
            
            const senders = pc.getSenders();
            const existingVideoSender = senders.find(sender => 
              sender.track && sender.track.kind === 'video'
            );

            console.log(`🖥️ Существующие senders для пользователя ${userId}:`, senders.map(s => ({
              trackKind: s.track?.kind,
              trackId: s.track?.id,
              trackLabel: s.track?.label
            })));

            if (existingVideoSender) {
              await existingVideoSender.replaceTrack(videoTrack);
              console.log(`🖥️ Заменен видео трек для пользователя ${userId}`);
            } else {
              pc.addTrack(videoTrack, this.screenStream!);
              console.log(`🖥️ Добавлен видео трек для пользователя ${userId}`);
            }
          } else {
            console.error(`🖥️ Видео трек не найден в screenStream!`);
          }

          const audioTracks = this.screenStream!.getAudioTracks();
          if (audioTracks.length > 0) {
            const existingAudioSenders = pc.getSenders().filter(sender => 
              sender.track && sender.track.kind === 'audio'
            );
            
            const isSystemAudio = audioTracks[0].label.includes('System') || 
                                 audioTracks[0].label.includes('Desktop') ||
                                 audioTracks[0].getSettings().deviceId !== 'default';
            
            if (isSystemAudio) {
              pc.addTrack(audioTracks[0], this.screenStream!);
              console.log(`🖥️ Добавлен системный аудио трек для пользователя ${userId}`);
            }
          }

          if (pc.connectionState === 'connected' || pc.connectionState === 'new') {
            console.log(`🖥️ Создаем offer для пользователя ${userId} с видео треком`);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.log(`🖥️ Offer создан и отправлен пользователю ${userId}:`, {
              sdpLength: offer.sdp?.length,
              hasVideo: offer.sdp?.includes('m=video'),
              hasAudio: offer.sdp?.includes('m=audio')
            });
            this.sendMessage({
              type: 'offer',
              target_id: userId,
              offer: offer,
            });
          } else {
            console.log(`🖥️ Пропускаем создание offer для пользователя ${userId}, состояние: ${pc.connectionState}`);
          }
        } catch (error) {
          console.error(`🖥️ Ошибка добавления видео трека для пользователя ${userId}:`, error);
        }
      });

      this.createLocalScreenShareVideo();

      this.isScreenSharing = true;
      
      this.sendMessage({ 
        type: 'screen_share_start'
      });

      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
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

    const currentUserId = this.getCurrentUserId();
    
    this.screenStream.getTracks().forEach(track => {
      track.stop();
    });

    this.peerConnections.forEach(({ pc }, userId) => {
      try {
        const senders = pc.getSenders();
        senders.forEach((sender: RTCRtpSender) => {
          if (sender.track && sender.track.kind === 'video') {
            sender.replaceTrack(null).then(() => {
              console.log(`🖥️ Видео трек остановлен для пользователя ${userId}`);
            }).catch(error => {
              console.error(`🖥️ Ошибка остановки видео трека для пользователя ${userId}:`, error);
              pc.removeTrack(sender);
            });
          }
        });

        if (pc.connectionState === 'connected') {
          pc.createOffer().then((offer: RTCSessionDescriptionInit) => {
            pc.setLocalDescription(offer);
            this.sendMessage({
              type: 'offer',
              target_id: userId,
              offer: offer,
            });
          }).catch((error: any) => {
            console.error(`🖥️ Ошибка создания offer без видео для пользователя ${userId}:`, error);
          });
        }
      } catch (error) {
        console.error(`🖥️ Ошибка при остановке демонстрации для пользователя ${userId}:`, error);
      }
    });

    this.screenStream = null;
    this.isScreenSharing = false;

    if (currentUserId && this.onScreenShareChanged) {
      this.onScreenShareChanged(currentUserId, false);
    }

    this.sendMessage({ 
      type: 'screen_share_stop'
    });

    if (currentUserId) {
      const event = new CustomEvent('screen_share_stop', {
        detail: { 
          user_id: currentUserId
        }
      });
      window.dispatchEvent(event);
      console.log('🖥️ Отправлено событие screen_share_stop для пользователя:', currentUserId);
    }

    console.log('🖥️ Демонстрация экрана остановлена');
  }

  getScreenSharingStatus(): boolean {
    return this.isScreenSharing;
  }

  onScreenShareChange(callback: (userId: number, isSharing: boolean) => void) {
    this.onScreenShareChanged = callback;
  }

  private createLocalScreenShareVideo() {
    if (!this.screenStream) return;

    console.log('🖥️ Создаем локальный видео элемент для стримера');

    const currentUserId = this.getCurrentUserId();
    if (!currentUserId) return;

    const existingVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
    if (existingVideo) {
      existingVideo.remove();
    }

    const localVideo = document.createElement('video');
    localVideo.id = `remote-video-${currentUserId}`;
    localVideo.autoplay = true;
    localVideo.controls = false;
    localVideo.muted = true;
    localVideo.style.position = 'absolute';
    localVideo.style.top = '0';
    localVideo.style.left = '0';
    localVideo.style.width = '100%';
    localVideo.style.height = '100%';
    localVideo.style.objectFit = 'contain';
    localVideo.style.backgroundColor = '#000';
    
    localVideo.addEventListener('loadeddata', () => {
      console.log('🖥️ Локальное видео загружено');
    });
    
    localVideo.addEventListener('error', (e) => {
      console.error('🖥️ Ошибка загрузки локального видео:', e);
    });
    
    localVideo.srcObject = this.screenStream;
    
    const waitForContainer = (attempts = 0): void => {
      const videoContainer = document.getElementById('screen-share-container-chat');
      
      if (videoContainer) {
        videoContainer.appendChild(localVideo);
        console.log('🖥️ Локальный видео элемент добавлен в ChatArea. Контейнер размеры:', {
          width: videoContainer.offsetWidth,
          height: videoContainer.offsetHeight,
          style: videoContainer.style.cssText,
          videoSrc: localVideo.srcObject ? 'есть' : 'нет',
          childrenCount: videoContainer.children.length
        });
        
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
      } else if (attempts < 50) {
        console.log(`🖥️ Ожидание контейнера screen-share-container-chat (попытка ${attempts + 1}/50)`);
        setTimeout(() => waitForContainer(attempts + 1), 100);
      } else {
        console.error('🖥️ Превышено время ожидания контейнера screen-share-container-chat');
        localVideo.remove();
        return;
      }
    };
    
    waitForContainer();

    if (this.onScreenShareChanged) {
      this.onScreenShareChanged(currentUserId, true);
    }
  }

  getDebugInfo() {
    const peerConnectionsInfo = Array.from(this.peerConnections.entries()).map(([userId, { pc }]) => {
      const audioElement = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement;
      
      return {
        userId,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
        audioElement: audioElement ? {
          exists: true,
          muted: audioElement.muted,
          volume: audioElement.volume,
          paused: audioElement.paused,
          readyState: audioElement.readyState,
          networkState: audioElement.networkState,
          srcObject: !!audioElement.srcObject,
          currentTime: audioElement.currentTime,
          duration: audioElement.duration
        } : {
          exists: false
        }
      };
    });

    return {
      isConnected: !!this.ws && this.ws.readyState === WebSocket.OPEN,
      voiceChannelId: this.voiceChannelId,
      hasLocalStream: !!this.localStream,
      hasRawStream: !!this.rawStream,
      peerConnections: peerConnectionsInfo,
      audioContext: this.audioContext ? {
        state: this.audioContext.state,
        sampleRate: this.audioContext.sampleRate
      } : null,
      isScreenSharing: this.isScreenSharing,
      isSpeaking: this.isSpeaking,
      isManuallyMuted: this.isManuallyMuted
    };
  }

  // Получение метрик аудио
  getAudioMetrics() {
    return {
      ...this.audioMetrics,
      isConnected: !!this.ws && this.ws.readyState === WebSocket.OPEN,
      peerConnectionsCount: this.peerConnections.size,
      hasLocalStream: !!this.localStream,
      hasRawStream: !!this.rawStream,
      audioContextState: this.audioContext?.state,
      isSpeaking: this.isSpeaking,
      isManuallyMuted: this.isManuallyMuted,
      audioDataLogging: this.audioDataLogging
    };
  }

  // Новая функция для диагностики аудио проблем
  diagnoseAudioIssues() {
    console.log('🔊 🔍 Диагностика аудио проблем:');
    
    const metrics = this.getAudioMetrics();
    console.log('📊 Аудио метрики:', metrics);
    
    // Проверка основных компонентов
    const diagnostics = {
      webSocketConnection: {
        status: this.ws?.readyState === WebSocket.OPEN ? '✅ Подключен' : '❌ Отключен',
        readyState: this.ws?.readyState,
        url: this.ws?.url
      },
      audioStreams: {
        localStream: this.localStream ? '✅ Есть' : '❌ Нет',
        rawStream: this.rawStream ? '✅ Есть' : '❌ Нет',
        localStreamTracks: this.localStream?.getTracks().map(t => ({
          kind: t.kind,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState,
          muted: t.muted
        })) || []
      },
      audioContext: {
        state: this.audioContext?.state || 'не создан',
        sampleRate: this.audioContext?.sampleRate,
        currentTime: this.audioContext?.currentTime
      },
      peerConnections: Array.from(this.peerConnections.entries()).map(([userId, { pc }]) => ({
        userId,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState,
        senders: pc.getSenders().map(sender => ({
          trackKind: sender.track?.kind,
          trackEnabled: sender.track?.enabled,
          trackReadyState: sender.track?.readyState
        }))
      })),
      audioElements: Array.from(document.querySelectorAll('audio[id^="remote-audio-"]')).map(audio => {
        const audioEl = audio as HTMLAudioElement;
        return {
          id: audioEl.id,
          volume: audioEl.volume,
          muted: audioEl.muted,
          paused: audioEl.paused,
          readyState: audioEl.readyState,
          networkState: audioEl.networkState,
          hasSource: !!audioEl.srcObject,
          currentTime: audioEl.currentTime,
          duration: audioEl.duration
        };
      })
    };
    
    console.log('🔧 Детальная диагностика:', diagnostics);
    
    // Автоматические рекомендации
    const recommendations = [];
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      recommendations.push('❌ WebSocket не подключен - проверьте сетевое соединение');
    }
    
    if (!this.localStream) {
      recommendations.push('❌ Нет локального аудио потока - проверьте разрешения микрофона');
    }
    
    if (this.audioContext?.state !== 'running') {
      recommendations.push('⚠️ AudioContext не запущен - может потребоваться взаимодействие пользователя');
    }
    
    if (this.peerConnections.size === 0) {
      recommendations.push('⚠️ Нет peer соединений - убедитесь, что другие пользователи в канале');
    }
    
    const connectedPeers = Array.from(this.peerConnections.values()).filter(({ pc }) => pc.connectionState === 'connected');
    if (connectedPeers.length !== this.peerConnections.size) {
      recommendations.push(`⚠️ Не все peer соединения активны: ${connectedPeers.length}/${this.peerConnections.size}`);
    }
    
    const audioElements = document.querySelectorAll('audio[id^="remote-audio-"]');
    const workingAudioElements = Array.from(audioElements).filter(audio => {
      const audioEl = audio as HTMLAudioElement;
      return !audioEl.paused && audioEl.readyState >= 2; // HAVE_CURRENT_DATA
    });
    
    if (audioElements.length !== workingAudioElements.length) {
      recommendations.push(`⚠️ Не все аудио элементы воспроизводятся: ${workingAudioElements.length}/${audioElements.length}`);
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ Все компоненты работают нормально');
    }
    
    console.log('💡 Рекомендации:', recommendations);
    
    return {
      metrics,
      diagnostics,
      recommendations,
      timestamp: new Date().toISOString()
    };
  }
}

const voiceService = new VoiceService();

// Добавляем в глобальный объект для отладки
if (typeof window !== 'undefined') {
  (window as any).voiceService = voiceService;
}

export default voiceService;