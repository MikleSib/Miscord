import websocketService from './websocketService';
import { EventEmitter } from 'events';

class P2PVoiceService extends EventEmitter {
  public peerConnection: RTCPeerConnection | null = null;
  public localStream: MediaStream | null = null;
  public remoteStream: MediaStream | null = null;
  private ws = websocketService;

  constructor() {
    super();
    if (typeof window !== 'undefined') {
      window.addEventListener('webrtc_signal', (e: Event) => this.handleWebSocketMessage(e as CustomEvent));
    }
  }

  private handleWebSocketMessage(event: CustomEvent) {
    const { sender_id, signal } = event.detail;
    if (!this.peerConnection) {
      this.initiatePeerConnection(sender_id, false); // Не инициатор
    }

    if (signal.type === 'offer') {
      this.peerConnection?.setRemoteDescription(new RTCSessionDescription(signal));
      this.createAnswer(sender_id);
    } else if (signal.type === 'answer') {
      this.peerConnection?.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate) {
      this.peerConnection?.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  }

  private async initiatePeerConnection(friendId: number, isInitiator: boolean) {
    if (this.peerConnection) {
      console.warn("PeerConnection уже существует.");
      return;
    }
    
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (error) {
      console.error("Ошибка при получении доступа к аудио:", error);
      // Можно добавить обработку ошибки, например, уведомить пользователя
      this.stopCall(); // Останавливаем звонок, если не удалось получить доступ к аудио
      return;
    }
    
    this.localStream.getTracks().forEach(track => this.peerConnection?.addTrack(track, this.localStream!));

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send(JSON.stringify({
          type: 'webrtc',
          recipient_id: friendId,
          signal: { candidate: event.candidate }
        }));
      }
    };

    this.peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      // Здесь можно будет обновить UI, чтобы показать видео собеседника
    };

    if (isInitiator) {
      this.emit('outgoing_call', friendId);
    } else {
      this.emit('incoming_call', friendId);
    }
  }

  public async startCall(friendId: number) {
    if (!this.peerConnection) {
      await this.initiatePeerConnection(friendId, true); // Является инициатором
    }
    const offer = await this.peerConnection?.createOffer();
    await this.peerConnection?.setLocalDescription(offer);
    this.ws.send(JSON.stringify({
      type: 'webrtc',
      recipient_id: friendId,
      signal: offer
    }));
  }

  private async createAnswer(friendId: number) {
    const answer = await this.peerConnection?.createAnswer();
    await this.peerConnection?.setLocalDescription(answer);
    this.ws.send(JSON.stringify({
      type: 'webrtc',
      recipient_id: friendId,
      signal: answer
    }));
  }

  public async acceptCall() {
    // В данном случае принятие звонка происходит автоматически при получении сигнала
    // Но можно добавить дополнительную логику здесь
    this.emit('call_accepted');
  }

  public stopCall() {
    this.localStream?.getTracks().forEach(track => track.stop());
    this.peerConnection?.close();
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.emit('call_ended');
  }
}

const p2pVoiceService = new P2PVoiceService();
export default p2pVoiceService;
