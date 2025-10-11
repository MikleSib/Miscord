/**
 * Оптимизированный голосовой сервис
 * Использует единый унифицированный WebSocket для WebRTC сигналинга
 */

import unifiedWebSocketService from './unifiedWebSocketService';
import { audioProcessingService } from './audioProcessingService';
import soundService from './soundService';
import { advancedNoiseGate } from './advancedNoiseGate';

interface PeerConnection {
  pc: RTCPeerConnection;
  userId: number;
  stream?: MediaStream;
}

interface VoiceParticipant {
  user_id: number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  is_muted?: boolean;
  is_deafened?: boolean;
  is_sharing_screen?: boolean;
}

class OptimizedVoiceService {
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peerConnections: Map<number, PeerConnection> = new Map();
  private pendingIceCandidates: Map<number, RTCIceCandidateInit[]> = new Map();
  private iceServers: RTCIceServer[] = [];
  private currentVoiceChannelId: number | null = null;
  
  // Callbacks
  private onParticipantJoinedCallback: ((participant: VoiceParticipant) => void) | null = null;
  private onParticipantLeftCallback: ((userId: number) => void) | null = null;
  private onSpeakingChangedCallback: ((userId: number, isSpeaking: boolean) => void) | null = null;
  private onParticipantsReceivedCallback: ((participants: VoiceParticipant[]) => void) | null = null;
  private onParticipantStatusChangedCallback: ((userId: number, status: Partial<{ is_muted: boolean; is_deafened: boolean }>) => void) | null = null;
  private onScreenShareChangedCallback: ((userId: number, isSharing: boolean) => void) | null = null;
  private onRemoteStreamCallback: ((userId: number, stream: MediaStream) => void) | null = null;

  // Локальное состояние
  private isMuted: boolean = false;
  private isDeafened: boolean = false;
  private isScreenSharing: boolean = false;
  private isSpeaking: boolean = false;
  private speakingUsers: Set<number> = new Set();
  private participantDirectory: Map<number, VoiceParticipant> = new Map();
  
  // VAD
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: NodeJS.Timeout | null = null;
  private vadThreshold: number = 50;
  private inputMode: 'voice-activity' | 'push-to-talk' = 'voice-activity';
  private pttKey: string = 'Space';
  private isPTTActive: boolean = false;
  private pttKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private adaptiveQualityEnabled: boolean = true;

  public vadThresholds = { total: 25, mid: 20, max: 30 };

  constructor() {
    this.setupUnifiedWebSocketHandlers();
    console.log('[OptimizedVoice] ✅ Сервис инициализирован');
  }

  /**
   * Настройка обработчиков унифицированного WebSocket
   */
  private setupUnifiedWebSocketHandlers(): void {
    // Получение списка участников
    unifiedWebSocketService.onVoiceParticipants(async (data) => {
      console.log('[OptimizedVoice] 👥 Получен список участников:', data.participants);
      
      this.iceServers = data.ice_servers || [
        { urls: 'stun:stun.l.google.com:19302' }
      ];

      // Создаем peer connections для существующих участников
      for (const participant of data.participants) {
        this.participantDirectory.set(participant.user_id, participant);
        await this.createPeerConnection(participant.user_id, true); // true = создать offer
      }

      if (this.onParticipantsReceivedCallback) {
        this.onParticipantsReceivedCallback(data.participants);
      }
    });

    // Новый участник присоединился
    unifiedWebSocketService.onUserJoinedVoice(async (data) => {
      console.log('[OptimizedVoice] 👤 Участник присоединился:', data);
      
      this.participantDirectory.set(data.user_id, data);

      if (this.onParticipantJoinedCallback) {
        this.onParticipantJoinedCallback(data);
      }

      soundService.playJoinSound();
    });

    // Участник покинул канал
    unifiedWebSocketService.onUserLeftVoice((data) => {
      console.log('[OptimizedVoice] 👋 Участник покинул канал:', data.user_id);
      
      this.closePeerConnection(data.user_id);
      this.participantDirectory.delete(data.user_id);

      if (this.onParticipantLeftCallback) {
        this.onParticipantLeftCallback(data.user_id);
      }

      soundService.playLeaveSound();
    });

    // WebRTC Signaling
    unifiedWebSocketService.onVoiceOffer(async (data) => {
      console.log('[OptimizedVoice] 📨 Получен offer от:', data.from_id);
      await this.handleOffer(data.from_id, data.offer);
    });

    unifiedWebSocketService.onVoiceAnswer(async (data) => {
      console.log('[OptimizedVoice] 📨 Получен answer от:', data.from_id);
      await this.handleAnswer(data.from_id, data.answer);
    });

    unifiedWebSocketService.onVoiceIceCandidate((data) => {
      console.log('[OptimizedVoice] 🧊 Получен ICE candidate от:', data.from_id);
      this.handleIceCandidate(data.from_id, data.candidate);
    });

    // Статусы участников
    unifiedWebSocketService.onUserMuted((data) => {
      console.log('[OptimizedVoice] 🔇 Участник изменил статус mute:', data);
      if (this.onParticipantStatusChangedCallback) {
        this.onParticipantStatusChangedCallback(data.user_id, { is_muted: data.is_muted });
      }
    });

    unifiedWebSocketService.onUserDeafened((data) => {
      console.log('[OptimizedVoice] 🔇 Участник изменил статус deafen:', data);
      if (this.onParticipantStatusChangedCallback) {
        this.onParticipantStatusChangedCallback(data.user_id, { is_deafened: data.is_deafened });
      }
    });

    unifiedWebSocketService.onUserSpeaking((data) => {
      if (data.is_speaking) {
        this.speakingUsers.add(data.user_id);
      } else {
        this.speakingUsers.delete(data.user_id);
      }

      if (this.onSpeakingChangedCallback) {
        this.onSpeakingChangedCallback(data.user_id, data.is_speaking);
      }
    });

    // Screen sharing
    unifiedWebSocketService.onScreenShareStarted((data) => {
      console.log('[OptimizedVoice] 🖥️ Начало screen share:', data);
      if (this.onScreenShareChangedCallback) {
        this.onScreenShareChangedCallback(data.user_id, true);
      }
    });

    unifiedWebSocketService.onScreenShareStopped((data) => {
      console.log('[OptimizedVoice] 🖥️ Остановка screen share:', data);
      if (this.onScreenShareChangedCallback) {
        this.onScreenShareChangedCallback(data.user_id, false);
      }
    });
  }

  /**
   * Присоединение к голосовому каналу
   */
  public async joinVoiceChannel(channelId: number): Promise<void> {
    console.log('[OptimizedVoice] 🎤 Присоединение к каналу:', channelId);

    try {
      // Получаем локальный поток
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1
        },
        video: false
      });

      console.log('[OptimizedVoice] ✅ Локальный поток получен');

      // Инициализируем аудио обработку
      await this.initializeAudioProcessing();

      // Отправляем запрос на присоединение
      this.currentVoiceChannelId = channelId;
      unifiedWebSocketService.joinVoiceChannel(channelId);

      soundService.playJoinSound();
    } catch (error) {
      console.error('[OptimizedVoice] ❌ Ошибка присоединения:', error);
      throw error;
    }
  }

  /**
   * Покинуть голосовой канал
   */
  public async leaveVoiceChannel(): Promise<void> {
    if (!this.currentVoiceChannelId) return;

    console.log('[OptimizedVoice] 👋 Покидание канала:', this.currentVoiceChannelId);

    // Отправляем уведомление
    unifiedWebSocketService.leaveVoiceChannel(this.currentVoiceChannelId);

    // Закрываем все peer connections
    const userIds = Array.from(this.peerConnections.keys());
    for (const userId of userIds) {
      this.closePeerConnection(userId);
    }

    // Останавливаем локальный поток
    this.stopLocalStream();

    // Очищаем состояние
    this.currentVoiceChannelId = null;
    this.participantDirectory.clear();
    this.speakingUsers.clear();

    soundService.playLeaveSound();
  }

  /**
   * Создание peer connection
   */
  private async createPeerConnection(userId: number, createOffer: boolean): Promise<void> {
    if (this.peerConnections.has(userId)) {
      console.warn('[OptimizedVoice] Peer connection уже существует для:', userId);
      return;
    }

    console.log('[OptimizedVoice] 🔗 Создание peer connection для:', userId, 'createOffer:', createOffer);

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    // Добавляем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Обработчики
    pc.onicecandidate = (event) => {
      if (event.candidate && this.currentVoiceChannelId) {
        unifiedWebSocketService.sendVoiceIceCandidate(
          userId,
          this.currentVoiceChannelId,
          event.candidate.toJSON()
        );
      }
    };

    pc.ontrack = (event) => {
      console.log('[OptimizedVoice] 🎵 Получен удаленный поток от:', userId);
      const stream = event.streams[0];
      
      const peerConn = this.peerConnections.get(userId);
      if (peerConn) {
        peerConn.stream = stream;
      }

      if (this.onRemoteStreamCallback) {
        this.onRemoteStreamCallback(userId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[OptimizedVoice] 🔄 Connection state changed:', userId, pc.connectionState);
      
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn('[OptimizedVoice] ⚠️ Connection failed/disconnected for:', userId);
      }
    };

    this.peerConnections.set(userId, { pc, userId });

    // Создаем offer если нужно
    if (createOffer && this.currentVoiceChannelId) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      unifiedWebSocketService.sendVoiceOffer(
        userId,
        this.currentVoiceChannelId,
        offer
      );
    }
  }

  /**
   * Обработка полученного offer
   */
  private async handleOffer(userId: number, offer: RTCSessionDescriptionInit): Promise<void> {
    let peerConn = this.peerConnections.get(userId);

    if (!peerConn) {
      await this.createPeerConnection(userId, false);
      peerConn = this.peerConnections.get(userId);
    }

    if (!peerConn) return;

    try {
      await peerConn.pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Обрабатываем отложенные ICE candidates
      const pending = this.pendingIceCandidates.get(userId);
      if (pending) {
        for (const candidate of pending) {
          await peerConn.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.pendingIceCandidates.delete(userId);
      }

      // Создаем answer
      const answer = await peerConn.pc.createAnswer();
      await peerConn.pc.setLocalDescription(answer);

      if (this.currentVoiceChannelId) {
        unifiedWebSocketService.sendVoiceAnswer(
          userId,
          this.currentVoiceChannelId,
          answer
        );
      }
    } catch (error) {
      console.error('[OptimizedVoice] ❌ Ошибка обработки offer:', error);
    }
  }

  /**
   * Обработка полученного answer
   */
  private async handleAnswer(userId: number, answer: RTCSessionDescriptionInit): Promise<void> {
    const peerConn = this.peerConnections.get(userId);
    if (!peerConn) return;

    try {
      await peerConn.pc.setRemoteDescription(new RTCSessionDescription(answer));

      // Обрабатываем отложенные ICE candidates
      const pending = this.pendingIceCandidates.get(userId);
      if (pending) {
        for (const candidate of pending) {
          await peerConn.pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.pendingIceCandidates.delete(userId);
      }
    } catch (error) {
      console.error('[OptimizedVoice] ❌ Ошибка обработки answer:', error);
    }
  }

  /**
   * Обработка ICE candidate
   */
  private async handleIceCandidate(userId: number, candidate: RTCIceCandidateInit): Promise<void> {
    const peerConn = this.peerConnections.get(userId);

    if (!peerConn || !peerConn.pc.remoteDescription) {
      // Сохраняем для последующей обработки
      if (!this.pendingIceCandidates.has(userId)) {
        this.pendingIceCandidates.set(userId, []);
      }
      this.pendingIceCandidates.get(userId)!.push(candidate);
      return;
    }

    try {
      await peerConn.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('[OptimizedVoice] ❌ Ошибка добавления ICE candidate:', error);
    }
  }

  /**
   * Закрытие peer connection
   */
  private closePeerConnection(userId: number): void {
    const peerConn = this.peerConnections.get(userId);
    if (peerConn) {
      peerConn.pc.close();
      this.peerConnections.delete(userId);
    }
    this.pendingIceCandidates.delete(userId);
  }

  /**
   * Инициализация аудио обработки и VAD
   */
  private async initializeAudioProcessing(): Promise<void> {
    if (!this.localStream) return;

    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      source.connect(this.analyser);

      // Запускаем VAD если включен
      if (this.inputMode === 'voice-activity') {
        this.startVAD();
      }

      console.log('[OptimizedVoice] ✅ Аудио обработка инициализирована');
    } catch (error) {
      console.error('[OptimizedVoice] ❌ Ошибка инициализации аудио:', error);
    }
  }

  /**
   * Запуск Voice Activity Detection
   */
  private startVAD(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
    }

    this.vadInterval = setInterval(() => {
      if (!this.analyser || this.isMuted) return;

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);

      const sum = dataArray.reduce((a, b) => a + b, 0);
      const average = sum / dataArray.length;

      const speaking = average > this.vadThreshold;

      if (speaking !== this.isSpeaking) {
        this.isSpeaking = speaking;
        
        if (this.currentVoiceChannelId) {
          unifiedWebSocketService.updateSpeakingStatus(
            this.currentVoiceChannelId,
            speaking
          );
        }
      }
    }, 100);
  }

  /**
   * Остановка VAD
   */
  private stopVAD(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
  }

  /**
   * Остановка локального потока
   */
  private stopLocalStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.stopVAD();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // ==================== PUBLIC API ====================

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;

    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }

    if (this.currentVoiceChannelId) {
      unifiedWebSocketService.updateMuteStatus(this.currentVoiceChannelId, this.isMuted);
    }

    console.log('[OptimizedVoice] 🔇 Mute:', this.isMuted);
    return this.isMuted;
  }

  public toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;

    if (this.currentVoiceChannelId) {
      unifiedWebSocketService.updateDeafenStatus(this.currentVoiceChannelId, this.isDeafened);
    }

    console.log('[OptimizedVoice] 🔇 Deafen:', this.isDeafened);
    return this.isDeafened;
  }

  public updateVADThresholds(sensitivity: number): void {
    this.vadThreshold = sensitivity;
    console.log('[OptimizedVoice] 🎙️ VAD threshold updated:', sensitivity);
  }

  public setInputMode(mode: 'voice-activity' | 'push-to-talk'): void {
    this.inputMode = mode;
    
    if (mode === 'voice-activity') {
      this.removePTTHandlers();
      this.startVAD();
    } else {
      this.stopVAD();
      this.setupPTTHandlers();
    }
  }

  public setPTTKey(key: string): void {
    this.pttKey = key;
    this.removePTTHandlers();
    if (this.inputMode === 'push-to-talk') {
      this.setupPTTHandlers();
    }
  }

  private setupPTTHandlers(): void {
    this.pttKeyHandler = (e: KeyboardEvent) => {
      if (e.code === this.pttKey) {
        if (e.type === 'keydown' && !this.isPTTActive) {
          this.isPTTActive = true;
          this.isSpeaking = true;
          
          if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
              track.enabled = true;
            });
          }

          if (this.currentVoiceChannelId) {
            unifiedWebSocketService.updateSpeakingStatus(this.currentVoiceChannelId, true);
          }
        } else if (e.type === 'keyup' && this.isPTTActive) {
          this.isPTTActive = false;
          this.isSpeaking = false;

          if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
              track.enabled = false;
            });
          }

          if (this.currentVoiceChannelId) {
            unifiedWebSocketService.updateSpeakingStatus(this.currentVoiceChannelId, false);
          }
        }
      }
    };

    window.addEventListener('keydown', this.pttKeyHandler);
    window.addEventListener('keyup', this.pttKeyHandler);
  }

  private removePTTHandlers(): void {
    if (this.pttKeyHandler) {
      window.removeEventListener('keydown', this.pttKeyHandler);
      window.removeEventListener('keyup', this.pttKeyHandler);
      this.pttKeyHandler = null;
    }
  }

  // ==================== CALLBACKS ====================

  public onParticipantJoined(callback: (participant: VoiceParticipant) => void): void {
    this.onParticipantJoinedCallback = callback;
  }

  public onParticipantLeft(callback: (userId: number) => void): void {
    this.onParticipantLeftCallback = callback;
  }

  public onSpeakingChanged(callback: (userId: number, isSpeaking: boolean) => void): void {
    this.onSpeakingChangedCallback = callback;
  }

  public onParticipantsReceived(callback: (participants: VoiceParticipant[]) => void): void {
    this.onParticipantsReceivedCallback = callback;
  }

  public onParticipantStatusChanged(callback: (userId: number, status: any) => void): void {
    this.onParticipantStatusChangedCallback = callback;
  }

  public onScreenShareChanged(callback: (userId: number, isSharing: boolean) => void): void {
    this.onScreenShareChangedCallback = callback;
  }

  public onRemoteStream(callback: (userId: number, stream: MediaStream) => void): void {
    this.onRemoteStreamCallback = callback;
  }

  // ==================== GETTERS ====================

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public getIsDeafened(): boolean {
    return this.isDeafened;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  public getSpeakingUsers(): Set<number> {
    return this.speakingUsers;
  }

  public getCurrentVoiceChannelId(): number | null {
    return this.currentVoiceChannelId;
  }

  public getRemoteStream(userId: number): MediaStream | undefined {
    return this.peerConnections.get(userId)?.stream;
  }
}

// Singleton экземпляр
export const optimizedVoiceService = new OptimizedVoiceService();
export default optimizedVoiceService;

