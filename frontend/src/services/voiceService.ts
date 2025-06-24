const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

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

  async connect(voiceChannelId: number, token: string) {
    // Проверяем, не подключены ли мы уже к этому каналу
    if (this.voiceChannelId === voiceChannelId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    
    // Если подключены к другому каналу или соединение закрыто, сначала очищаем
    if (this.ws || this.voiceChannelId) {
      this.cleanup();
    }
    
    this.voiceChannelId = voiceChannelId;
    this.token = token;

    // Получаем доступ к микрофону
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      
      // Инициализируем детекцию голосовой активности
      this.initVoiceActivityDetection();
    } catch (error) {
      throw new Error('Не удалось получить доступ к микрофону');
    }

    // Подключаемся к WebSocket
    const wsUrl = `${WS_URL}/ws/voice/${voiceChannelId}?token=${token}`;
    this.ws = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => {
        resolve();
      };

      this.ws!.onerror = (error) => {
        reject(new Error('Ошибка подключения WebSocket'));
      };

      this.ws!.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        await this.handleMessage(data);
      };

      this.ws!.onclose = (event) => {
        this.cleanup();
      };
    });
  }

  private async handleMessage(data: any) {
    switch (data.type) {
      case 'participants':
        this.iceServers = data.ice_servers;
        
        // Передаем список участников в store
        if (this.onParticipantsReceivedCallback) {
          this.onParticipantsReceivedCallback(data.participants);
        }
        
        // Создаем соединения с существующими участниками (кроме себя)
        const currentUserId = this.getCurrentUserId();
        for (const participant of data.participants) {
          if (participant.user_id !== currentUserId) {
            // Создаем offer только если наш ID меньше
            const shouldCreateOffer = currentUserId !== null && currentUserId < participant.user_id;
            await this.createPeerConnection(participant.user_id, shouldCreateOffer);
          }
        }
        break;

      case 'user_joined_voice':
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
        if (this.onParticipantLeft) {
          this.onParticipantLeft(data.user_id);
        }
        this.removePeerConnection(data.user_id);
        break;

      case 'offer':
        await this.handleOffer(data.from_id, data.offer);
        break;

      case 'answer':
        await this.handleAnswer(data.from_id, data.answer);
        break;

      case 'ice_candidate':
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
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, data.status);
        }
        break;

      case 'screen_share_started':
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, true);
        }
        break;

      case 'screen_share_stopped':
        // Удаляем видео элемент
        const videoElement = document.getElementById(`remote-video-${data.user_id}`);
        if (videoElement) {
          videoElement.remove();
        }
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, false);
        }
        break;
    }
  }

  private async createPeerConnection(userId: number, createOffer: boolean) {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Добавляем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Обработка входящего потока
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();

        // Обрабатываем аудио треки
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
          
          // Применяем сохраненную громкость если есть
          setTimeout(() => {
            const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
            if (savedVolume) {
              const volume = parseInt(savedVolume);
              remoteAudio.volume = Math.min(volume / 100, 3.0);
            }
          }, 100);
          
          // Пытаемся воспроизвести аудио
          const playPromise = remoteAudio.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              // Аудио успешно воспроизводится
            }).catch(error => {
              const enableAudio = () => {
                remoteAudio.play().then(() => {
                  document.removeEventListener('click', enableAudio);
                  document.removeEventListener('touchstart', enableAudio);
                }).catch(e => {
                  // Ошибка воспроизведения
                });
              };
              
              document.addEventListener('click', enableAudio, { once: true });
              document.addEventListener('touchstart', enableAudio, { once: true });
            });
          }
        }

        // Обрабатываем видео треки (демонстрация экрана)
        if (videoTracks.length > 0) {
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
            
            // Ждем появления контейнера в ChatArea для удалённого видео
            const waitForRemoteContainer = (attempts = 0): void => {
              const videoContainer = document.getElementById('screen-share-container-chat');
              
              if (videoContainer) {
                // Контейнер найден, добавляем видео
                videoContainer.innerHTML = '';
                videoContainer.appendChild(remoteVideo);
              } else if (attempts < 50) { // Максимум 5 секунд
                // Контейнер ещё не создан, ждем
                setTimeout(() => waitForRemoteContainer(attempts + 1), 100);
              } else {
                // Превышено время ожидания
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
        }
      }
    };

    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendMessage({
          type: 'ice_candidate',
          target_id: userId,
          candidate: event.candidate,
        });
      }
    };

    this.peerConnections.set(userId, { pc, userId });

    if (createOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendMessage({
        type: 'offer',
        target_id: userId,
        offer: offer,
      });
    }
  }

  private async handleOffer(userId: number, offer: RTCSessionDescriptionInit) {
    let peerConnection = this.peerConnections.get(userId);
    
    if (!peerConnection) {
      await this.createPeerConnection(userId, false);
      peerConnection = this.peerConnections.get(userId)!;
    }

    try {
      await peerConnection.pc.setRemoteDescription(offer);
      
      const answer = await peerConnection.pc.createAnswer();
      await peerConnection.pc.setLocalDescription(answer);

      this.sendMessage({
        type: 'answer',
        target_id: userId,
        answer: answer,
      });
    } catch (error) {
      // Ошибка обработки offer
    }
  }

  private async handleAnswer(userId: number, answer: RTCSessionDescriptionInit) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      try {
        await peerConnection.pc.setRemoteDescription(answer);
      } catch (error) {
        // Ошибка обработки answer
      }
    }
  }

  private async handleIceCandidate(userId: number, candidate: RTCIceCandidateInit) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      try {
        await peerConnection.pc.addIceCandidate(candidate);
      } catch (error) {
        // Ошибка добавления ICE candidate
      }
    }
  }

  private removePeerConnection(userId: number) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      peerConnection.pc.close();
      this.peerConnections.delete(userId);
    }
    
    // Удаляем аудио элемент из DOM
    const audioElement = document.getElementById(`remote-audio-${userId}`);
    if (audioElement) {
      audioElement.remove();
    }

    // Удаляем видео элемент из DOM
    const videoElement = document.getElementById(`remote-video-${userId}`);
    if (videoElement) {
      videoElement.remove();
      
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
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
    this.sendMessage({ type: 'mute', is_muted: muted });
  }

  setDeafened(deafened: boolean) {
    // Заглушаем всех удаленных пользователей
    this.peerConnections.forEach((_, userId) => {
      const audioElement = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement;
      if (audioElement) {
        audioElement.muted = deafened;
      }
    });
    
    this.sendMessage({ type: 'deafen', is_deafened: deafened });
  }

  onParticipantJoin(callback: (participant: any) => void) {
    this.onParticipantJoined = callback;
  }

  onParticipantLeave(callback: (userId: number) => void) {
    this.onParticipantLeft = callback;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.cleanup();
  }

  private cleanup() {
    // Останавливаем детекцию голосовой активности
    this.cleanupVoiceActivityDetection();

    // Закрываем все peer connections
    this.peerConnections.forEach((peerConnection, userId) => {
      peerConnection.pc.close();
      
      // Удаляем аудио элементы
      const audioElement = document.getElementById(`remote-audio-${userId}`);
      if (audioElement) {
        audioElement.remove();
      }

      // Удаляем видео элементы
      const videoElement = document.getElementById(`remote-video-${userId}`);
      if (videoElement) {
        videoElement.remove();
      }
    });
    this.peerConnections.clear();

    // Останавливаем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Останавливаем поток демонстрации экрана
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
      this.isScreenSharing = false;
    }

    // Очищаем контейнер демонстрации экрана
    const screenShareContainer = document.getElementById('screen-share-container-chat');
    if (screenShareContainer) {
      screenShareContainer.innerHTML = '';
    }

    // Удаляем все остаточные видео элементы
    const remainingVideos = document.querySelectorAll('video[id^="remote-video-"]');
    remainingVideos.forEach(video => {
      video.remove();
    });

    this.ws = null;
    this.voiceChannelId = null;
    this.token = null;
    this.iceServers = [];
  }

  private initVoiceActivityDetection() {
    if (!this.localStream) return;

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      
      this.analyser.fftSize = 256;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
      this.analyser.smoothingTimeConstant = 0.85;
      
      source.connect(this.analyser);
      
      this.startVoiceActivityDetection();
    } catch (error) {
      // Ошибка инициализации VAD
    }
  }

  private startVoiceActivityDetection() {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const checkAudioLevel = () => {
      try {
        this.analyser!.getByteFrequencyData(dataArray);
        
        // Анализируем разные частотные диапазоны
        const lowFreq = dataArray.slice(0, bufferLength / 4);
        const midFreq = dataArray.slice(bufferLength / 4, bufferLength / 2);
        const highFreq = dataArray.slice(bufferLength / 2, bufferLength);
        
        // Вычисляем средние значения для каждого диапазона
        const lowAverage = lowFreq.reduce((a, b) => a + b, 0) / lowFreq.length;
        const midAverage = midFreq.reduce((a, b) => a + b, 0) / midFreq.length;
        const highAverage = highFreq.reduce((a, b) => a + b, 0) / highFreq.length;
        
        // Общий средний уровень с весами
        const totalAverage = (lowAverage * 0.3 + midAverage * 0.5 + highAverage * 0.2);
        
                 // Максимальное значение в средних частотах (голос)
         let maxValue = 0;
         for (let i = 0; i < midFreq.length; i++) {
           if (midFreq[i] > maxValue) {
             maxValue = midFreq[i];
           }
         }
        
        // Порог для определения речи (более чувствительный)
        const speechThreshold = 35;
        const maxThreshold = 80;
        
        const currentlySpeaking = (totalAverage > speechThreshold && maxValue > maxThreshold);
        
        // Отправляем информацию о голосовой активности только при изменении
        if (currentlySpeaking !== this.isSpeaking) {
          this.isSpeaking = currentlySpeaking;
          this.sendMessage({
            type: 'speaking',
            is_speaking: this.isSpeaking
          });
        }
      } catch (error) {
        // Ошибка анализа голосовой активности
      }
    };

    this.vadInterval = setInterval(checkAudioLevel, 100) as any;
  }

  private getCurrentUserId(): number | null {
    if (!this.token) return null;
    
    try {
      const payload = JSON.parse(atob(this.token.split('.')[1]));
      return payload.user_id || null;
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
      // Получаем поток экрана
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: true // Включаем звук системы если доступен
      });

      // Обрабатываем событие остановки демонстрации экрана
      this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        this.stopScreenShare();
      });

      // Обрабатываем событие остановки аудио трека
      const audioTracks = this.screenStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].addEventListener('ended', () => {
          // Системный звук остановлен
        });
      }

      // Добавляем видео трек ко всем peer connections
      this.peerConnections.forEach(async ({ pc }, userId) => {
        try {
          // Добавляем видео трек
          const videoTracks = this.screenStream!.getVideoTracks();
          if (videoTracks.length > 0) {
            pc.addTrack(videoTracks[0], this.screenStream!);
          }

          // Добавляем системный аудио если доступен
          if (audioTracks.length > 0) {
            const existingAudioSenders = pc.getSenders().filter(sender => 
              sender.track && sender.track.kind === 'audio'
            );
            
            // Добавляем только если это не микрофонный трек
            const isSystemAudio = audioTracks[0].label.includes('System') || 
                                 audioTracks[0].label.includes('Desktop') ||
                                 audioTracks[0].getSettings().deviceId !== 'default';
            
            if (isSystemAudio) {
              pc.addTrack(audioTracks[0], this.screenStream!);
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
          }
        } catch (error) {
          // Ошибка добавления видео трека
        }
      });

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
          // Не удалось получить имя пользователя из токена
        }
        
        const event = new CustomEvent('screen_share_start', {
          detail: { 
            user_id: currentUserId,
            username: username
          }
        });
        window.dispatchEvent(event);
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    // Отправляем локальное событие для немедленного обновления UI
    const userId = this.getCurrentUserId();
    if (userId) {
      const event = new CustomEvent('screen_share_stop', {
        detail: { 
          user_id: userId
        }
      });
      window.dispatchEvent(event);
    }

    // Останавливаем все треки
    this.screenStream.getTracks().forEach(track => {
      track.stop();
    });

    // Удаляем видео треки из всех peer connections
    this.peerConnections.forEach(async ({ pc }, userId) => {
      try {
        const senders = pc.getSenders();
        senders.forEach((sender: RTCRtpSender) => {
          if (sender.track && sender.track.kind === 'video') {
            // Заменяем видео трек на null вместо удаления
            sender.replaceTrack(null).then(() => {
              // Видео трек остановлен
            }).catch(error => {
              // Если replaceTrack не работает, удаляем трек
              pc.removeTrack(sender);
            });
          }
        });

        // Создаем новый offer без видео только если connection активно
        if (pc.connectionState === 'connected') {
          pc.createOffer().then((offer: RTCSessionDescriptionInit) => {
            pc.setLocalDescription(offer);
            this.sendMessage({
              type: 'offer',
              target_id: userId,
              offer: offer,
            });
          }).catch((error: any) => {
            // Ошибка создания offer без видео
          });
        }
      } catch (error) {
        // Ошибка при остановке демонстрации
      }
    });

    this.screenStream = null;
    this.isScreenSharing = false;

    // Удаляем локальный видео элемент
    const currentUserId = this.getCurrentUserId();
    if (currentUserId) {
      const localVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
      if (localVideo) {
        localVideo.remove();
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
  }

  getScreenSharingStatus(): boolean {
    return this.isScreenSharing;
  }

  onScreenShareChange(callback: (userId: number, isSharing: boolean) => void) {
    this.onScreenShareChanged = callback;
  }

  private createLocalScreenShareVideo() {
    const currentUserId = this.getCurrentUserId();
    if (!currentUserId || !this.screenStream) return;

    // Создаем видео элемент для локального пользователя
    let localVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
    if (!localVideo) {
      localVideo = document.createElement('video');
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
    }
    
    localVideo.srcObject = this.screenStream;
    
    // Ждем появления контейнера в ChatArea (максимум 5 секунд)
    const waitForContainer = (attempts = 0): void => {
      const videoContainer = document.getElementById('screen-share-container-chat');
      
      if (videoContainer) {
        // Контейнер найден, добавляем видео
        videoContainer.innerHTML = '';
        videoContainer.appendChild(localVideo);
        
        // Проверяем, что видео элемент действительно добавлен
        setTimeout(() => {
          const addedVideo = document.getElementById(`remote-video-${currentUserId}`);
          if (addedVideo) {
            // Видео элемент найден в DOM
          }
        }, 1000);
      } else if (attempts < 50) {
        // Контейнер ещё не создан, ждем
        setTimeout(() => waitForContainer(attempts + 1), 100);
      } else {
        // Превышено время ожидания
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

export default new VoiceService();