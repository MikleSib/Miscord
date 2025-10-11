import websocketService from './websocketService';
import { EventEmitter } from 'events';
import { User } from '@/types';
import authService from './authService';

class P2PVoiceService extends EventEmitter {
  public peerConnection: RTCPeerConnection | null = null;
  public localStream: MediaStream | null = null;
  public remoteStream: MediaStream | null = null;
  private ws = websocketService;
  private currentPeerId: number | null = null;
  private currentUser: User | null = null;
  private isMuted: boolean = false;
  private isDeafened: boolean = false;

  private handlersRegistered = false;

  constructor() {
    super();
    this.init();
    // Регистрируем обработчики сразу при создании экземпляра
    this.registerWebSocketHandlers();
  }

  private async init() {
    this.currentUser = await authService.getCurrentUser();
  }

  // Метод для регистрации WebSocket обработчиков
  // Регистрация происходит только один раз, чтобы избежать дублирования
  public registerWebSocketHandlers() {
    if (this.handlersRegistered) {
      console.log('[P2PVoiceService] Обработчики уже зарегистрированы, пропускаем');
      return;
    }
    this.handlersRegistered = true;
    this.ws.on('p2p-offer', async (data: { from: number; offer: RTCSessionDescriptionInit }) => {
      console.log('[P2PVoiceService] Received offer from:', data.from);
      this.currentPeerId = data.from;
      // Создаем peer connection при получении offer (для обоих участников)
      if (!this.peerConnection) {
        await this.createPeerConnection(data.from);
      }
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        this.ws.send({
          type: 'p2p-answer',
          to: data.from,
          answer: answer
        });
        console.log('[P2PVoiceService] Sent answer to:', data.from);
      }
    });

    this.ws.on('p2p-answer', async (data: { from: number; answer: RTCSessionDescriptionInit }) => {
      if (this.peerConnection) {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    this.ws.on('p2p-ice-candidate', (data: { from: number; candidate: RTCIceCandidateInit }) => {
      if (this.peerConnection && data.candidate) {
        this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch(e => console.error("Ошибка добавления ICE candidate:", e));
      }
    });

    this.ws.on('p2p-call-ended', () => {
      this.stopCall();
      this.emit('call_ended');
    });
  }

  private async createPeerConnection(peerId: number) {
    this.stopCall(); // Закрываем предыдущие соединения

    // Используем TURN сервер для P2P соединений
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
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.localStream.getTracks().forEach(track => this.peerConnection?.addTrack(track, this.localStream!));
    } catch (error) {
      console.error("Ошибка при получении доступа к аудио:", error);
      this.stopCall();
      return;
    }

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send({
          type: 'p2p-ice-candidate',
          to: this.currentPeerId,
          candidate: event.candidate
        });
      }
    };

    this.peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      this.emit('remote_stream_received', this.remoteStream);
    };
  }
  
  public initiateCall(userId: number) {
    if (!this.currentUser) {
        console.error("Текущий пользователь не определен.");
        return;
    }
    this.ws.send({
      type: 'p2p-initiate-call',
      to: userId,
      from: this.currentUser
    });
  }

  public async acceptCall(callerId: number, caller: User) {
    // Не создаем peer connection здесь, а только после получения offer
    this.currentPeerId = callerId;
    this.ws.send({
      type: 'p2p-accept-call',
      to: callerId,
      from: this.currentUser
    });

    // Инициатор звонка (тот, кто звонил) должен создать offer
  }
  
  public async createOffer(recipientId: number) {
    await this.createPeerConnection(recipientId);
    if(this.peerConnection) {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.ws.send({
          type: 'p2p-offer',
          to: recipientId,
          offer: offer
      });
    }
  }

  public declineCall(callerId: number) {
    console.log('[P2PVoiceService] declineCall called with callerId:', callerId);
    if (!callerId || typeof callerId !== 'number') {
      console.error('[P2PVoiceService] declineCall: invalid callerId:', callerId);
      return;
    }
    const message = {
      type: 'p2p-decline-call',
      to: callerId
    };
    console.log('[P2PVoiceService] Sending decline message:', message);
    this.ws.send(message);
  }

  // Храним информацию о текущем звонящем для возможности отклонения
  private currentCaller: User | null = null;

  public setCurrentCaller(caller: User | null) {
    this.currentCaller = caller;
  }

  public getCurrentCaller(): User | null {
    return this.currentCaller;
  }

  public hangUp(peerId: number) {
    this.ws.send({
        type: 'p2p-hang-up',
        to: peerId
    });
    this.stopCall();
    this.emit('call_ended');
  }

  public stopCall() {
    this.localStream?.getTracks().forEach(track => track.stop());
    this.peerConnection?.close();
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.currentPeerId = null;
  }

  // Управление микрофоном
  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !this.isMuted;
      });
    }
    this.emit('mute_changed', this.isMuted);
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  // Управление наушниками
  public toggleDeafen(): boolean {
    this.isDeafened = !this.isDeafened;
    this.emit('deafen_changed', this.isDeafened);
    return this.isDeafened;
  }

  public getIsDeafened(): boolean {
    return this.isDeafened;
  }
}

const p2pVoiceService = new P2PVoiceService();
export default p2pVoiceService;
