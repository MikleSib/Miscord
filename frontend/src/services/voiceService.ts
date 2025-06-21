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
    switch (data.type) {
      case 'participants':
        this.iceServers = data.ice_servers;
        // Создаем соединения с существующими участниками
        for (const participant of data.participants) {
          await this.createPeerConnection(participant.user_id, true);
        }
        break;

      case 'user_joined_voice':
        if (this.onParticipantJoined) {
          this.onParticipantJoined(data.user_id, data.username);
        }
        await this.createPeerConnection(data.user_id, true);
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
      console.log('Received remote stream from user', userId);
      // Здесь можно обработать входящий аудиопоток
      const remoteAudio = new Audio();
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play();
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

    await peerConnection.pc.setRemoteDescription(offer);
    const answer = await peerConnection.pc.createAnswer();
    await peerConnection.pc.setLocalDescription(answer);

    this.sendMessage({
      type: 'answer',
      target_id: userId,
      answer: answer,
    });
  }

  private async handleAnswer(userId: number, answer: RTCSessionDescriptionInit) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      await peerConnection.pc.setRemoteDescription(answer);
    }
  }

  private async handleIceCandidate(userId: number, candidate: RTCIceCandidateInit) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      await peerConnection.pc.addIceCandidate(candidate);
    }
  }

  private removePeerConnection(userId: number) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      peerConnection.pc.close();
      this.peerConnections.delete(userId);
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
    // Реализация отключения звука
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
    // Закрываем все peer connections
    this.peerConnections.forEach(({ pc }) => pc.close());
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
      
      this.analyser.fftSize = 512;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
      this.analyser.smoothingTimeConstant = 0.85;
      
      source.connect(this.analyser);
      
      this.startVoiceActivityDetection();
    } catch (error) {
      console.error('🎙️ Ошибка инициализации VAD:', error);
    }
  }

  private startVoiceActivityDetection() {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.vadInterval = window.setInterval(() => {
      this.analyser!.getByteFrequencyData(dataArray);
      
      // Вычисляем среднюю громкость
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      // Порог для определения речи (можно настроить)
      const threshold = 30;
      const currentlySpeaking = average > threshold;
      
      if (currentlySpeaking !== this.isSpeaking) {
        this.isSpeaking = currentlySpeaking;
        
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
    }, 100); // Проверяем каждые 100мс
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
}

export default new VoiceService();