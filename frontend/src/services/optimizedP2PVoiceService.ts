/**
 * Оптимизированный P2P голосовой сервис
 * Использует единый унифицированный WebSocket
 */

import unifiedWebSocketService from './unifiedWebSocketService';
import { EventEmitter } from 'events';
import { User } from '@/types';
import soundService from './soundService';

class OptimizedP2PVoiceService extends EventEmitter {
  public peerConnection: RTCPeerConnection | null = null;
  public localStream: MediaStream | null = null;
  public remoteStream: MediaStream | null = null;
  private currentPeerId: number | null = null;
  private currentCaller: User | null = null;
  private isMuted: boolean = false;
  private isDeafened: boolean = false;

  constructor() {
    super();
    this.setupUnifiedWebSocketHandlers();
    console.log('[OptimizedP2P] ✅ Сервис инициализирован');
  }

  /**
   * Настройка обработчиков унифицированного WebSocket
   */
  private setupUnifiedWebSocketHandlers(): void {
    // Входящий звонок
    unifiedWebSocketService.onP2PIncomingCall((data) => {
      console.log('[OptimizedP2P] 📞 Входящий звонок от:', data.caller);
      this.currentCaller = data.caller;
      this.emit('incoming_call', data.caller);
    });

    // Звонок принят
    unifiedWebSocketService.onP2PCallAccepted((data) => {
      console.log('[OptimizedP2P] ✅ Звонок принят:', data.recipient);
      this.createOffer(data.recipient.id);
    });

    // Звонок отклонен
    unifiedWebSocketService.onP2PCallDeclined((data) => {
      console.log('[OptimizedP2P] ❌ Звонок отклонен:', data.recipient);
      this.stopCall();
      this.emit('call_declined', data.recipient);
    });

    // Звонок завершен
    unifiedWebSocketService.onP2PCallEnded(() => {
      console.log('[OptimizedP2P] 📵 Звонок завершен');
      this.stopCall();
      this.emit('call_ended');
    });

    // WebRTC Signaling
    unifiedWebSocketService.onP2POffer(async (data) => {
      console.log('[OptimizedP2P] 📨 Получен offer от:', data.from);
      await this.handleOffer(data.from, data.offer);
    });

    unifiedWebSocketService.onP2PAnswer(async (data) => {
      console.log('[OptimizedP2P] 📨 Получен answer от:', data.from);
      await this.handleAnswer(data.answer);
    });

    unifiedWebSocketService.onP2PIceCandidate((data) => {
      console.log('[OptimizedP2P] 🧊 Получен ICE candidate от:', data.from);
      this.handleIceCandidate(data.candidate);
    });
  }

  /**
   * Инициация звонка
   */
  public initiateCall(userId: number): void {
    console.log('[OptimizedP2P] 📞 Инициация звонка пользователю:', userId);
    unifiedWebSocketService.initiateP2PCall(userId);
  }

  /**
   * Принятие звонка
   */
  public async acceptCall(callerId: number, caller: User): Promise<void> {
    console.log('[OptimizedP2P] ✅ Принятие звонка от:', callerId);
    
    this.currentPeerId = callerId;
    this.currentCaller = caller;
    
    // Отправляем подтверждение
    unifiedWebSocketService.acceptP2PCall(callerId);
  }

  /**
   * Отклонение звонка
   */
  public declineCall(callerId: number): void {
    console.log('[OptimizedP2P] ❌ Отклонение звонка от:', callerId);
    
    if (!callerId || typeof callerId !== 'number') {
      console.error('[OptimizedP2P] Некорректный ID звонящего:', callerId);
      return;
    }

    unifiedWebSocketService.declineP2PCall(callerId);
    this.currentCaller = null;
  }

  /**
   * Завершение звонка
   */
  public hangUp(peerId: number): void {
    console.log('[OptimizedP2P] 📵 Завершение звонка с:', peerId);
    
    unifiedWebSocketService.hangupP2PCall(peerId);
    this.stopCall();
    this.emit('call_ended');
  }

  /**
   * Создание peer connection
   */
  private async createPeerConnection(peerId: number): Promise<void> {
    this.stopCall();

    console.log('[OptimizedP2P] 🔗 Создание peer connection для:', peerId);

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: ['turn:147.45.158.183:3478'],
          username: 'stream-cash',
          credential: 'CHANGE_ME_LONG_RANDOM_SECRET_12345'
        }
      ]
    });

    this.currentPeerId = peerId;

    try {
      // Получаем локальный поток
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      // Добавляем треки
      this.localStream.getTracks().forEach(track => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });

      console.log('[OptimizedP2P] ✅ Локальный поток добавлен');
    } catch (error) {
      console.error('[OptimizedP2P] ❌ Ошибка получения аудио:', error);
      this.stopCall();
      return;
    }

    // Обработчик ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        unifiedWebSocketService.sendP2PIceCandidate(
          this.currentPeerId!,
          event.candidate.toJSON()
        );
      }
    };

    // Обработчик удаленного потока
    this.peerConnection.ontrack = (event) => {
      console.log('[OptimizedP2P] 🎵 Получен удаленный поток');
      this.remoteStream = event.streams[0];
      this.emit('remote_stream_received', this.remoteStream);
    };

    // Обработчик состояния соединения
    this.peerConnection.onconnectionstatechange = () => {
      console.log('[OptimizedP2P] 🔄 Connection state:', this.peerConnection?.connectionState);
      
      if (this.peerConnection?.connectionState === 'failed' || 
          this.peerConnection?.connectionState === 'disconnected') {
        console.warn('[OptimizedP2P] ⚠️ Connection failed/disconnected');
        this.stopCall();
        this.emit('connection_failed');
      }
    };
  }

  /**
   * Создание offer
   */
  public async createOffer(recipientId: number): Promise<void> {
    await this.createPeerConnection(recipientId);
    
    if (!this.peerConnection) return;

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      unifiedWebSocketService.sendP2POffer(recipientId, offer);
      console.log('[OptimizedP2P] 📤 Offer отправлен');
    } catch (error) {
      console.error('[OptimizedP2P] ❌ Ошибка создания offer:', error);
    }
  }

  /**
   * Обработка полученного offer
   */
  private async handleOffer(from: number, offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      await this.createPeerConnection(from);
    }

    if (!this.peerConnection) return;

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      unifiedWebSocketService.sendP2PAnswer(from, answer);
      console.log('[OptimizedP2P] 📤 Answer отправлен');
    } catch (error) {
      console.error('[OptimizedP2P] ❌ Ошибка обработки offer:', error);
    }
  }

  /**
   * Обработка полученного answer
   */
  private async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) return;

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('[OptimizedP2P] ✅ Answer обработан');
    } catch (error) {
      console.error('[OptimizedP2P] ❌ Ошибка обработки answer:', error);
    }
  }

  /**
   * Обработка ICE candidate
   */
  private async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection || !candidate) return;

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('[OptimizedP2P] ❌ Ошибка добавления ICE candidate:', error);
    }
  }

  /**
   * Остановка звонка
   */
  public stopCall(): void {
    console.log('[OptimizedP2P] 🛑 Остановка звонка');

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.currentPeerId = null;
    this.currentCaller = null;
  }

  // ==================== УПРАВЛЕНИЕ АУДИО ====================

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }

    soundService.playMicToggleSound(this.isMuted);
    this.emit('mute_changed', this.isMuted);
    console.log('[OptimizedP2P] 🔇 Mute:', this.isMuted);
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    this.emit('deafen_changed', this.isDeafened);
    console.log('[OptimizedP2P] 🔇 Deafen:', this.isDeafened);
    return this.isDeafened;
  }

  public getIsDeafened(): boolean {
    return this.isDeafened;
  }

  // ==================== GETTERS ====================

  public setCurrentCaller(caller: User | null): void {
    this.currentCaller = caller;
  }

  public getCurrentCaller(): User | null {
    return this.currentCaller;
  }

  public getCurrentPeerId(): number | null {
    return this.currentPeerId;
  }
}

// Singleton экземпляр
const optimizedP2PVoiceService = new OptimizedP2PVoiceService();
export default optimizedP2PVoiceService;

