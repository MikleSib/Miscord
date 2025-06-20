const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000';

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

  async connect(voiceChannelId: number, token: string) {
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
    } catch (error) {
      console.error('Error accessing microphone:', error);
      throw new Error('Не удалось получить доступ к микрофону');
    }

    // Подключаемся к WebSocket
    const wsUrl = `${WS_URL}/ws/voice/${voiceChannelId}?token=${token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('Voice WebSocket connected');
    };

    this.ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      await this.handleMessage(data);
    };

    this.ws.onerror = (error) => {
      console.error('Voice WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('Voice WebSocket disconnected');
      this.cleanup();
    };
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

    this.voiceChannelId = null;
    this.token = null;
  }
}

export default new VoiceService();