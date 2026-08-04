import websocketService from './websocketService';
import { EventEmitter } from 'events';
import { User } from '@/types';

class P2PVoiceService extends EventEmitter {
  public peerConnection: RTCPeerConnection | null = null;
  public localStream: MediaStream | null = null;
  public remoteStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private originalAudioTrack: MediaStreamTrack | null = null;
  private ws = websocketService;
  private currentPeerId: number | null = null;
  private currentUser: User | null = null;
  private isMuted: boolean = false;
  private isDeafened: boolean = false;
  private isScreenSharing: boolean = false;

  private handlersRegistered = false;
  private pendingIceCandidates: RTCIceCandidateInit[] = []; // Буфер для ICE кандидатов
  private isProcessingOffer: boolean = false; // Флаг для предотвращения дублирующихся offers

  constructor() {
    super();
  }

  public setCurrentUser(user: User | null) {
    this.currentUser = user;
  }
  public registerWebSocketHandlers() {
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;
    this.ws.on('p2p-offer', async (data: { from: number; offer: RTCSessionDescriptionInit }) => {
      // Игнорируем дублирующиеся offers от того же пира
      if (this.isProcessingOffer && this.currentPeerId === data.from) {
        return;
      }
      
      this.isProcessingOffer = true;
      this.currentPeerId = data.from;
      
      // Очищаем старые буферизованные кандидаты перед созданием нового соединения
      this.pendingIceCandidates = [];
      
      try {
        // ВСЕГДА пересоздаем соединение для нового offer
        // Это гарантирует корректный порядок m-lines в SDP
        await this.createPeerConnection(data.from);
        
        if (this.peerConnection) {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
          
          // Теперь обрабатываем буферизованные ICE кандидаты
          // (те, что пришли ПОСЛЕ createPeerConnection, но ДО setRemoteDescription)
          if (this.pendingIceCandidates.length > 0) {
            for (const candidate of this.pendingIceCandidates) {
              try {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                // Игнорируем ошибки - кандидат может быть невалидным
              }
            }
            this.pendingIceCandidates = []; // Очищаем буфер
          }
          
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);
          this.ws.send({
            type: 'p2p-answer',
            to: data.from,
            answer: answer
          });
        }
      } catch (error) {
        console.error('[P2P] Ошибка обработки offer:', error);
        // При ошибке очищаем всё
        this.stopCall();
      } finally {
        this.isProcessingOffer = false;
      }
    });

    this.ws.on('p2p-answer', async (data: { from: number; answer: RTCSessionDescriptionInit }) => {
      if (this.peerConnection && this.currentPeerId === data.from) {
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (error) {
          console.error('[P2P] Ошибка установки answer:', error);
          this.stopCall();
        }
      }
    });

    this.ws.on('p2p-ice-candidate', (data: { from: number; candidate: RTCIceCandidateInit }) => {
      // Игнорируем кандидаты не от текущего пира
      if (!this.peerConnection || !data.candidate || this.currentPeerId !== data.from) {
        return;
      }
      
      // Проверяем, установлен ли remoteDescription
      if (!this.peerConnection.remoteDescription) {
        // RemoteDescription еще не установлен, буферизуем ICE candidate
        this.pendingIceCandidates.push(data.candidate);
      } else {
        // RemoteDescription установлен, добавляем кандидат напрямую
        this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
          .catch(e => console.error("[P2P] Ошибка ICE candidate:", e));
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
    // Очищаем любое предыдущее соединение
    this.stopCall();
    
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
    // Очищаем буфер перед созданием нового соединения
    this.pendingIceCandidates = [];
    
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
    if (!callerId || typeof callerId !== 'number') {
      return;
    }
    this.ws.send({
      type: 'p2p-decline-call',
      to: callerId
    });
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
    // Останавливаем screen sharing если активно
    if (this.isScreenSharing) {
      this.stopScreenShare();
    }
    
    this.localStream?.getTracks().forEach(track => track.stop());
    this.screenStream?.getTracks().forEach(track => track.stop());
    this.peerConnection?.close();
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.screenStream = null;
    this.originalAudioTrack = null;
    this.currentPeerId = null;
    this.isScreenSharing = false;
    
    // Очищаем буфер и флаги
    this.pendingIceCandidates = [];
    this.isProcessingOffer = false;
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

  // Управление демонстрацией экрана
  public async startScreenShare(): Promise<void> {
    if (!this.peerConnection || this.isScreenSharing) {
      return;
    }

    try {
      // Получаем поток экрана
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];
      
      // Сохраняем оригинальный аудио трек
      if (this.localStream) {
        this.originalAudioTrack = this.localStream.getAudioTracks()[0];
      }

      // Находим sender для видео (или создаем новый)
      const videoSender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      
      if (videoSender) {
        // Заменяем существующий видео трек
        await videoSender.replaceTrack(screenTrack);
      } else {
        // Добавляем новый видео трек
        this.peerConnection.addTrack(screenTrack, this.screenStream);
      }

      this.isScreenSharing = true;
      this.emit('screen_share_changed', this.isScreenSharing);

      // Обработчик остановки демонстрации (когда пользователь нажимает "Прекратить показ" в браузере)
      screenTrack.onended = () => {
        this.stopScreenShare();
      };

    } catch (error) {
      console.error('[P2P] Ошибка запуска screen share:', error);
      this.isScreenSharing = false;
      this.emit('screen_share_changed', this.isScreenSharing);
    }
  }

  public stopScreenShare(): void {
    if (!this.peerConnection || !this.isScreenSharing) {
      return;
    }

    try {
      // Останавливаем все треки screen stream
      this.screenStream?.getTracks().forEach(track => track.stop());

      // Находим sender для видео
      const videoSender = this.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      
      if (videoSender) {
        // Удаляем видео трек
        this.peerConnection.removeTrack(videoSender);
      }

      this.screenStream = null;
      this.isScreenSharing = false;
      this.emit('screen_share_changed', this.isScreenSharing);

    } catch (error) {
      console.error('[P2P] Ошибка остановки screen share:', error);
    }
  }

  public getIsScreenSharing(): boolean {
    return this.isScreenSharing;
  }
}

const p2pVoiceService = new P2PVoiceService();
export default p2pVoiceService;
