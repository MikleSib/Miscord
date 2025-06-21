const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

console.log('🎙️ VoiceService инициализирован с WS_URL:', WS_URL);

interface PeerConnection {
  pc: RTCPeerConnection;
  userId: number;
}

class VoiceService {
  private ws: WebSocket | null = null;
  private localStream: MediaStream | null = null;
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

  async connect(voiceChannelId: number, token: string) {
    console.log('🎙️ VoiceService.connect вызван с параметрами:', { voiceChannelId, token: token ? 'есть' : 'нет' });
    
    this.voiceChannelId = voiceChannelId;
    this.token = token;

    // Получаем доступ к микрофону
    try {
      console.log('🎙️ Запрашиваем доступ к микрофону...');
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      console.log('🎙️ Доступ к микрофону получен');
      
      // Инициализируем детекцию голосовой активности
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
        if (this.onParticipantJoined) {
          this.onParticipantJoined(data.user_id, data.username);
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
    }
  }

  private async createPeerConnection(userId: number, createOffer: boolean) {
    console.log(`🔊 Создаем peer connection с пользователем ${userId}, createOffer: ${createOffer}`);
    
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

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
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.controls = false;
        remoteAudio.muted = false;
        remoteAudio.volume = 1.0;
        
        // Добавляем аудио элемент в DOM
        remoteAudio.id = `remote-audio-${userId}`;
        remoteAudio.style.display = 'none';
        document.body.appendChild(remoteAudio);
        
        // Пытаемся воспроизвести аудио
        const playPromise = remoteAudio.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            console.log('🔊 Аудио от пользователя', userId, 'успешно воспроизводится');
          }).catch(error => {
            console.error('🔊 Ошибка воспроизведения аудио от пользователя', userId, ':', error);
            
            // Пытаемся включить аудио при первом клике пользователя
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
    
    // Закрываем все peer connections
    this.peerConnections.forEach(({ pc, userId }) => {
      pc.close();
      // Удаляем соответствующий аудио элемент
      const audioElement = document.getElementById(`remote-audio-${userId}`);
      if (audioElement) {
        audioElement.remove();
      }
    });
    this.peerConnections.clear();

    // Останавливаем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Очищаем VAD
    this.cleanupVoiceActivityDetection();

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
}

export default new VoiceService();