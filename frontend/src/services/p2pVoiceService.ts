import websocketService from './websocketService';

class P2PVoiceService {
  public peerConnection: RTCPeerConnection | null = null;
  public localStream: MediaStream | null = null;
  public remoteStream: MediaStream | null = null;
  private ws = websocketService;

  constructor() {
    window.addEventListener('webrtc_signal', (e: Event) => this.handleWebSocketMessage(e as CustomEvent));
  }

  private handleWebSocketMessage(event: CustomEvent) {
    const { sender_id, signal } = event.detail;
    if (!this.peerConnection) {
      this.initiatePeerConnection(sender_id);
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

  private async initiatePeerConnection(friendId: number) {
    this.peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
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
  }

  public async startCall(friendId: number) {
    if (!this.peerConnection) {
      await this.initiatePeerConnection(friendId);
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

  public stopCall() {
    this.localStream?.getTracks().forEach(track => track.stop());
    this.peerConnection?.close();
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
  }
}

const p2pVoiceService = new P2PVoiceService();
export default p2pVoiceService;
