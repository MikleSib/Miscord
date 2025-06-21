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

  async connect(voiceChannelId: number, token: string) {
    console.log('🎙️ VoiceService.connect вызван с параметрами:', { voiceChannelId, token: token ? 'есть' : 'нет' });
    
    if (this.voiceChannelId === voiceChannelId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('🎙️ Уже подключены к этому каналу, пропускаем переподключение');
      return;
    }
    
    if (this.ws || this.voiceChannelId) {
      console.log('🎙️ Очищаем предыдущее соединение перед новым подключением');
      this.cleanup();
    }
    
    this.voiceChannelId = voiceChannelId;
    this.token = token;

    try {
      console.log('🎙️ Запрашиваем доступ к микрофону...');
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true, 
          autoGainControl: true,
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
      
      this.localStream = await noiseSuppressionService.processStream(rawStream);
      console.log('🔇 Поток обработан через сервис шумодава');
      
      if (this.localStream !== rawStream) {
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
        this.cleanup();
      };
    });
  }

  private async handleMessage(data: any) {
    console.log('🔊 VoiceService получил сообщение:', data.type, data);
    
    switch (data.type) {
      case 'participants':
        this.iceServers = data.ice_servers;
        console.log('🔊 ICE серверы:', this.iceServers);
        
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
        if (this.onSpeakingChanged) {
          this.onSpeakingChanged(data.user_id, data.is_speaking);
        }
        break;
        
      case 'user_muted':
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, { is_muted: data.is_muted });
        }
        break;
        
      case 'user_deafened':
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
        console.log('🔊 Неизвестное сообщение:', data);
    }
  }

  private async createPeerConnection(userId: number, createOffer: boolean) {
    console.log(`🔊 Создаем peer connection с пользователем ${userId}, createOffer: ${createOffer}`);
    
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        console.log(`🔊 Добавляем трек ${track.kind} в peer connection для пользователя ${userId}`);
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.ontrack = (event) => {
      console.log('🔊 Получен удаленный поток от пользователя', userId, {
        streams: event.streams,
        track: event.track,
        trackKind: event.track?.kind,
        trackId: event.track?.id,
        trackLabel: event.track?.label
      });
      
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
          const remoteAudio = new Audio();
          remoteAudio.srcObject = new MediaStream(audioTracks);
          remoteAudio.autoplay = true;
          remoteAudio.controls = false;
          remoteAudio.muted = false;
          remoteAudio.volume = 1.0;
          
          remoteAudio.id = `remote-audio-${userId}`;
          remoteAudio.style.display = 'none';
          document.body.appendChild(remoteAudio);
          
          setTimeout(() => {
            const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
            if (savedVolume) {
              const volume = parseInt(savedVolume);
              remoteAudio.volume = Math.min(volume / 100, 1.0);
              console.log(`🔊 Применена сохраненная громкость ${volume}% для пользователя ${userId}`);
            }
          }, 100);
          
          const playPromise = remoteAudio.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log('🔊 Аудио от пользователя', userId, 'успешно воспроизводится');
            }).catch(error => {
              console.error('🔊 Ошибка воспроизведения аудио от пользователя', userId, ':', error);
              
              const enableAudio = () => {
                remoteAudio.play().then(() => {
                  console.log('🔊 Аудио от пользователя', userId, 'включено после взаимодействия пользователя');
                  document.removeEventListener('click', enableAudio);
                  document.removeEventListener('touchstart', enableAudio);
                }).catch(e => {
                  console.error('🔊 Все еще не удается воспроизвести аудио от пользователя', userId, ':', e);
                });
              };
              
              document.addEventListener('click', enableAudio, { once: true });
              document.addEventListener('touchstart', enableAudio, { once: true });
            });
          }
        }

        if (videoTracks.length > 0) {
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
            
            remoteVideo.addEventListener('loadeddata', () => {
              console.log(`🖥️ Видео загружено для пользователя ${userId}`);
            });
            
            remoteVideo.addEventListener('error', (e) => {
              console.error(`🖥️ Ошибка загрузки видео для пользователя ${userId}:`, e);
            });
            
            const waitForRemoteContainer = (attempts = 0): void => {
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
                setTimeout(() => waitForRemoteContainer(attempts + 1), 100);
              } else {
                console.error(`🖥️ Превышено время ожидания контейнера для пользователя ${userId}`);
                remoteVideo.remove();
                return;
              }
            };
            
            waitForRemoteContainer();
          }
          
          remoteVideo.srcObject = new MediaStream(videoTracks);
          
          remoteVideo.addEventListener('loadedmetadata', () => {
            console.log(`🖥️ Метаданные видео загружены для пользователя ${userId}`, {
              videoWidth: remoteVideo.videoWidth,
              videoHeight: remoteVideo.videoHeight,
              readyState: remoteVideo.readyState
            });
          });
          
          remoteVideo.addEventListener('canplay', () => {
            console.log(`🖥️ Видео готово к воспроизведению для пользователя ${userId}`);
          });
          
          if (this.onScreenShareChanged) {
            this.onScreenShareChanged(userId, true);
          }
          
          console.log('🖥️ Видео элемент создан для пользователя', userId, {
            id: remoteVideo.id,
            srcObject: !!remoteVideo.srcObject,
            tracks: videoTracks.length
          });
        }
      }
    };

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

    pc.onconnectionstatechange = () => {
      console.log(`🔊 Состояние соединения с пользователем ${userId}: ${pc.connectionState}`);
      
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log(`🔊 Соединение с пользователем ${userId} потеряно (${pc.connectionState})`);
        
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
        
        this.removePeerConnection(userId);
      }
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
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
    this.sendMessage({ type: 'mute', is_muted: muted });
  }

  setDeafened(deafened: boolean) {
    console.log(`🔊 Установка deafened: ${deafened}`);
    
    this.peerConnections.forEach(({ userId }) => {
      const audioElement = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement;
      if (audioElement) {
        audioElement.muted = deafened;
        console.log(`🔊 ${deafened ? 'Заглушен' : 'Включен'} звук от пользователя ${userId}`);
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
    this.cleanup();
    if (this.ws) {
      this.ws.close();
    }
  }

  private cleanup() {
    console.log('🔊 Очистка VoiceService');
    
    this.peerConnections.forEach(({ pc, userId }) => {
      pc.close();
      const audioElement = document.getElementById(`remote-audio-${userId}`);
      if (audioElement) {
        audioElement.remove();
      }
      const videoElement = document.getElementById(`remote-video-${userId}`);
      if (videoElement) {
        videoElement.remove();
        console.log(`🖥️ Удален видео элемент для пользователя ${userId} при cleanup`);
      }
    });
    this.peerConnections.clear();

    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    this.isScreenSharing = false;

    const videoContainer = document.getElementById('screen-share-container-chat');
    if (videoContainer) {
      videoContainer.innerHTML = '';
      console.log('🖥️ Очищен контейнер screen-share-container-chat');
    }

    document.querySelectorAll('video[id^="remote-video-"]').forEach(video => {
      video.remove();
      console.log('🖥️ Удален остаточный видео элемент:', video.id);
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.cleanupVoiceActivityDetection();

    noiseSuppressionService.cleanup();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.voiceChannelId = null;
    this.token = null;
  }

  private initVoiceActivityDetection() {
    if (!this.localStream || !this.audioContext) return;

    try {
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      
      this.analyser.fftSize = 1024; 
      this.analyser.minDecibels = -100;
      this.analyser.maxDecibels = -10;
      this.analyser.smoothingTimeConstant = 0.3; 
      
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
        
        const { settings, setMicLevel } = useNoiseSuppressionStore.getState();

        if (!settings.vadEnabled) {
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            this.sendMessage({ type: 'speaking', is_speaking: true });
            const currentUserId = this.getCurrentUserId();
            if (currentUserId && this.onSpeakingChanged) {
              this.onSpeakingChanged(currentUserId, true);
            }
          }
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const micLevelDb = 20 * Math.log10(average / 255);
          setMicLevel(isFinite(micLevelDb) ? micLevelDb : -100);
          return;
        }

        const dbThreshold = settings.vadThreshold;
        const linearThreshold = Math.pow(10, dbThreshold / 20) * 255;

        const totalAverage = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const micLevelDb = 20 * Math.log10(totalAverage / 255);
        setMicLevel(isFinite(micLevelDb) ? micLevelDb : -100);
        
        const midFrequencyData = dataArray.slice(dataArray.length / 4, dataArray.length / 2);
        const midAverage = midFrequencyData.reduce((a, b) => a + b, 0) / midFrequencyData.length;
        const maxValue = Math.max(...Array.from(dataArray));
        
        const totalThreshold = Math.max(1, linearThreshold * 0.1);
        const midThreshold = Math.max(2, linearThreshold * 0.2); 
        const maxThreshold = Math.max(3, linearThreshold * 0.3);
        
        const currentlySpeaking = 
          totalAverage > totalThreshold || 
          midAverage > midThreshold || 
          maxValue > maxThreshold;
        
        if (currentlySpeaking !== this.isSpeaking) {
          this.isSpeaking = currentlySpeaking;
          
          console.log(`🎙️ Голосовая активность: ${currentlySpeaking ? 'ГОВОРИТ' : 'молчит'} (total: ${totalAverage.toFixed(1)}, mid: ${midAverage.toFixed(1)}, max: ${maxValue}) [пороги: total=${totalThreshold.toFixed(1)}, mid=${midThreshold.toFixed(1)}, max=${maxThreshold.toFixed(1)}, VAD=${dbThreshold}дБ]`);
          
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
    return {
      hasLocalStream: !!this.localStream,
      hasAudioContext: !!this.audioContext,
      voiceChannelId: this.voiceChannelId,
      peerConnectionsCount: this.peerConnections.size,
      wsState: this.ws?.readyState,
      localStreamTracks: this.localStream?.getTracks().length || 0,
      localStreamActive: this.localStream?.active || false
    };
  }
}

export default new VoiceService();