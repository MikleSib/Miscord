import websocketService from './websocketService';
import { EventEmitter } from 'events';

class P2PVoiceService extends EventEmitter {
  public peerConnection: RTCPeerConnection | null = null;
  public localStream: MediaStream | null = null;
  public remoteStream: MediaStream | null = null;
  private ws = websocketService;

  constructor() {
    super();
    this.ws.on('webrtc', (data: any) => this.handleWebSocketMessage(data));
  }

  private handleWebSocketMessage(data: { type: string, data: { sender_id: number, signal: any }}) {
    const { sender_id, signal } = data.data;

    if (signal.type === 'offer') {
      // Если звонок уже идет, не делаем ничего
      if (this.peerConnection) {
        console.warn("Получен offer, но PeerConnection уже существует. Возможно, звонок уже активен.");
        return;
      }
      this.initiatePeerConnection(sender_id, false, signal);
    } else if (this.peerConnection) {
      if (signal.type === 'answer') {
        this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal))
          .catch(e => console.error("Ошибка установки remote description для answer:", e));
      } else if (signal.candidate) {
        this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate))
          .catch(e => console.error("Ошибка добавления ICE candidate:", e));
      }
    }
  }

  private async initiatePeerConnection(friendId: number, isInitiator: boolean, offer?: RTCSessionDescriptionInit) {
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
      this.stopCall();
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
      this.emit('remote_stream_received', this.remoteStream);
    };

    if (isInitiator) {
      this.emit('outgoing_call', friendId);
    } else if (offer) {
       this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => {
          this.emit('incoming_call', friendId);
        })
        .catch(e => console.error("Ошибка установки remote description для offer:", e));
    }
  }

  public async startCall(friendId: number) {
    if (!this.peerConnection) {
      await this.initiatePeerConnection(friendId, true);
    }
    if (this.peerConnection) {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.ws.send(JSON.stringify({
        type: 'webrtc',
        recipient_id: friendId,
        signal: offer
      }));
    }
  }

  public async acceptCall(friendId: number) {
    if (this.peerConnection) {
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      this.ws.send(JSON.stringify({
        type: 'webrtc',
        recipient_id: friendId,
        signal: answer
      }));
      this.emit('call_accepted');
    }
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
