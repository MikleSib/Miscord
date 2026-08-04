import { audioProcessingService } from './audioProcessingService';
import { useNoiseSuppressionStore } from '../store/noiseSuppressionStore';
import { useAudioDeviceStore } from '../store/audioDeviceStore';
import { useAuthStore } from '../store/store';
import soundService from './soundService';
import { advancedNoiseGate } from './advancedNoiseGate';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';


// Глобальная переменная для отслеживания экземпляра
declare global {
  interface Window {
    __voiceServiceInstance?: VoiceService;
    // Тип для electronAPI описан в src/types/electron.d.ts; здесь оставляем any, чтобы не конфликтовать
    electronAPI?: any;
  }
}

interface PeerConnection {
  pc: RTCPeerConnection;
  userId: number;
}

class VoiceService {
  private ws: WebSocket | null = null;
  private rawInputStream: MediaStream | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null; // Поток демонстрации экрана
  private peerConnections: Map<number, PeerConnection> = new Map();
  // Буфер кандидатов ICE, пришедших до установки remoteDescription
  private pendingIceCandidates: Map<number, RTCIceCandidateInit[]> = new Map();
  private iceServers: RTCIceServer[] = [];
  private voiceChannelId: number | null = null;
  private token: string | null = null;
  private onParticipantJoined: ((participant: any) => void) | null = null;
  private onParticipantLeft: ((userId: number) => void) | null = null;
  private onSpeakingChanged: ((userId: number, isSpeaking: boolean) => void) | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: NodeJS.Timeout | number | null = null;
  private isSpeaking: boolean = false;
  private localSpeechDetected = false;
  private speakingIndicatorActive = false;
  private outboundStatsTimer: ReturnType<typeof setInterval> | null = null;
  private lastOutboundAudioBytes = new Map<number, number>();
  private speakingUsers: Set<number> = new Set();
  private onParticipantsReceivedCallback: ((participants: any[]) => void) | null = null;
  private onParticipantStatusChangedCallback: ((userId: number, status: Partial<{ is_muted: boolean; is_deafened: boolean }>) => void) | null = null;
  private onConnectionStateChanged: ((state: 'connected' | 'disconnected' | 'error', message?: string) => void) | null = null;
  private isScreenSharing: boolean = false; // Статус демонстрации экрана
  private onScreenShareChanged: ((userId: number, isSharing: boolean) => void) | null = null;
  private isMuted: boolean = false;
  private isDeafened: boolean = false;
  private adaptiveQualityEnabled: boolean = true; // Включено ли адаптивное качество
  // Локальный справочник участников: userId -> { username, avatar_url }
  private participantDirectory: Map<number, { username: string; avatar_url?: string }> = new Map();
  
  // VAD настройки
  private vadThreshold: number = 50; // 0-100, где 0 = максимально чувствительный
  private inputMode: 'voice-activity' | 'push-to-talk' = 'voice-activity';
  private pttKey: string = 'Space';
  private isPTTActive: boolean = false;
  private pttKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  public vadThresholds: { total: number; mid: number; max: number } = {
    total: 25,
    mid: 20,
    max: 30
  };

  // Публичные методы для работы с VAD
  public updateVADThresholds(sensitivity: number): void {
    console.log('🎙️ Обновление порогов VAD:', sensitivity);
    this.vadThreshold = sensitivity;
    
    // Обновляем пороги в audioProcessingService
    if (typeof audioProcessingService.updateVADThresholds === 'function') {
      audioProcessingService.updateVADThresholds(sensitivity);
    }
    
    console.log('🎙️ Пороги VAD обновлены через audioProcessingService');
  }

  public setInputMode(mode: 'voice-activity' | 'push-to-talk'): void {
    console.log('🎙️ Установка режима ввода:', mode);
    this.inputMode = mode;
    
    if (mode === 'push-to-talk') {
      this.setupPTTHandlers();
    } else {
      this.removePTTHandlers();
    }
  }

  public setPTTKey(key: string): void {
    console.log('🎙️ Установка клавиши PTT:', key);
    this.pttKey = key;
    
    if (this.inputMode === 'push-to-talk') {
      this.removePTTHandlers();
      this.setupPTTHandlers();
    }
  }

  public setupPTTHandlers(): void {
    if (this.pttKeyHandler) {
      this.removePTTHandlers();
    }
    
    this.pttKeyHandler = (e: KeyboardEvent) => {
      if (e.code === this.pttKey) {
        if (e.type === 'keydown' && !this.isPTTActive) {
          this.isPTTActive = true;
          this.unmute(); // Включаем микрофон
          this.setLocalSpeechDetected(true);
          console.log('🎙️ PTT активирован');
        } else if (e.type === 'keyup' && this.isPTTActive) {
          this.isPTTActive = false;
          this.setLocalSpeechDetected(false);
          this.mute(); // Отключаем микрофон
          console.log('🎙️ PTT деактивирован');
        }
      }
    };
    
    document.addEventListener('keydown', this.pttKeyHandler);
    document.addEventListener('keyup', this.pttKeyHandler);
    
    console.log('🎙️ PTT обработчики установлены для клавиши:', this.pttKey);
  }

  public removePTTHandlers(): void {
    if (this.pttKeyHandler) {
      document.removeEventListener('keydown', this.pttKeyHandler);
      document.removeEventListener('keyup', this.pttKeyHandler);
      this.pttKeyHandler = null;
      
      if (this.isPTTActive) {
        this.isPTTActive = false;
        this.mute();
      }
      
      console.log('🎙️ PTT обработчики удалены');
    }
  }

  public getCurrentVolume(): number {
    // Используем audioProcessingService для получения уровня громкости
    if (typeof audioProcessingService.getCurrentVolume === 'function') {
      return audioProcessingService.getCurrentVolume();
    }
    return 0;
  }

  public mute(): void {
    this.setMuted(true);
  }

  public unmute(): void {
    this.setMuted(false);
  }

  // Методы для уведомлений о разрешении аудио
  showAudioPermissionNotification(userId: number): void {
    // Удаляем существующее уведомление если есть
    this.hideAudioPermissionNotification();
    
    const notification = document.createElement('div');
    notification.id = 'audio-permission-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff6b6b;
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 300px;
      cursor: pointer;
    `;
    notification.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">🔊 Разрешите воспроизведение аудио</div>
      <div style="font-size: 12px; opacity: 0.9;">Кликните в любом месте для включения звука от других участников</div>
    `;
    
    // Добавляем обработчик клика
    notification.addEventListener('click', () => {
      console.log('🔊 Пользователь кликнул на уведомление о разрешении аудио');
      this.hideAudioPermissionNotification();
    });
    
    document.body.appendChild(notification);
    
    // Автоматически скрываем через 10 секунд
    setTimeout(() => {
      this.hideAudioPermissionNotification();
    }, 10000);
  }

  hideAudioPermissionNotification(): void {
    const notification = document.getElementById('audio-permission-notification');
    if (notification) {
      notification.remove();
    }
  }

  async connect(voiceChannelId: number, token: string, isMuted: boolean = false, isDeafened: boolean = false) {
    
    
    // Проверяем, не подключены ли мы уже к этому каналу
    if (this.voiceChannelId === voiceChannelId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    
    // Если есть активное WebSocket соединение, сначала закрываем его
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      
      this.disconnect();
      // Ждём немного для завершения закрытия
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Если подключены к другому каналу или соединение закрыто, сначала очищаем
    if (this.ws || this.voiceChannelId) {
      console.log('🎙️ Очищаем предыдущее соединение перед новым подключением');
      this.cleanup();
    }
    
    this.voiceChannelId = voiceChannelId;
    this.token = token;
    this.isMuted = isMuted;
    this.isDeafened = isDeafened;

    // Получаем доступ к микрофону
    try {
      const noiseSuppressionSettings = useNoiseSuppressionStore.getState();
      const useBrowserNoiseSuppression =
        noiseSuppressionSettings.enabled && noiseSuppressionSettings.engine === 'browser';

      // Не включаем два шумодава одновременно: каскадная обработка делает речь
      // металлической. AGC оставляем включённым, чтобы уровень микрофона был нормальным.
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: useBrowserNoiseSuppression,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
        video: false,
      });
      this.rawInputStream = rawStream;

      const bindSpeakingCallbacks = () => {
        audioProcessingService.setOnSpeechStart(() => {
          if (this.inputMode !== 'voice-activity') return;
          if (this.isMuted || this.isDeafened) return;
          this.setLocalSpeechDetected(true);
        });

        audioProcessingService.setOnSpeechEnd(() => {
          if (this.inputMode !== 'voice-activity') return;
          this.setLocalSpeechDetected(false);
        });
      };

      bindSpeakingCallbacks();

      // Инициализируем audioProcessingService и получаем обработанный поток
      const processedStream = await audioProcessingService.initialize(rawStream);
      
      // Используем обработанный поток для WebRTC (с VAD и другими эффектами)
      this.localStream = processedStream;
      // Громкость микрофона из настроек (по умолчанию 100%)
      audioProcessingService.setInputVolume(useAudioDeviceStore.getState().inputVolume ?? 100);
      audioProcessingService.setMuted(isMuted);
      processedStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });

      // VAD стартует внутри initialize — перезапускаем, чтобы callbacks точно были подключены
      await audioProcessingService.refreshSpeakingDetection();
      
      // Индикатор читает уже очищенный сигнал, а не исходный микрофон.
      audioProcessingService.analyzeVolume(processedStream);
    } catch (error) {
      console.error('🎙️ Ошибка доступа к микрофону:', error);
      this.rawInputStream?.getTracks().forEach((track) => track.stop());
      this.rawInputStream = null;
      throw new Error('Не удалось получить доступ к микрофону');
    }

    // Подключаемся к WebSocket
    const wsUrl = `${WS_URL}/ws/voice/${voiceChannelId}?token=${encodeURIComponent(token)}`;
    console.log('[VoiceService] Подключаемся к голосовому WebSocket:', wsUrl.replace(/token=.+/, 'token=***'));
    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const connectionTimeout = globalThis.setTimeout(() => {
        if (settled || this.ws !== socket) return;
        settled = true;
        const callback = this.onConnectionStateChanged;
        this.cleanup();
        callback?.('error', 'Сервер голосового канала не ответил вовремя');
        reject(new Error('Сервер голосового канала не ответил вовремя'));
      }, 15000);

      const clearConnectionTimeout = () => globalThis.clearTimeout(connectionTimeout);

      socket.onopen = () => {
        const joinMessage = {
          type: 'join',
          channel_id: voiceChannelId,
          is_muted: isMuted,
          is_deafened: isDeafened
        };
        socket.send(JSON.stringify(joinMessage));
        settled = true;
        clearConnectionTimeout();
        this.onConnectionStateChanged?.('connected');
        resolve();
      };

      socket.onerror = (event) => {
        console.error('🎙️ Ошибка Voice WebSocket:', event);
        if (!settled) {
          settled = true;
          clearConnectionTimeout();
          const callback = this.onConnectionStateChanged;
          this.cleanup();
          callback?.('error', 'Не удалось подключиться к голосовому каналу');
          reject(new Error('Не удалось подключиться к голосовому каналу'));
        }
      };

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          await this.handleMessage(data);
        } catch (error) {
          console.error('🎙️ Некорректное сообщение голосового WebSocket:', error);
        }
      };

      socket.onclose = (event) => {
        clearConnectionTimeout();

        if (!settled) {
          settled = true;
          reject(new Error(event.reason || 'Голосовое соединение было закрыто'));
        }

        if (this.ws === socket) {
          const callback = this.onConnectionStateChanged;
          const reason = event.reason || (event.code === 1000 ? undefined : 'Соединение с голосовым каналом потеряно');
          this.cleanup();
          callback?.('disconnected', reason);
        }
      };
    });
  }

  /**
   * Внедряет поддержку RED (Redundant Audio Data) для Opus в SDP.
   * Это повышает устойчивость к потере пакетов за счет отправки избыточных аудиоданных.
   * @param sdp Исходный SDP.
   * @returns Модифицированный SDP с поддержкой RED.
   */
  private enableOpusRed(sdp: string): string {
    if (!sdp.includes('m=audio')) return sdp;

    const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
    const redMatch = sdp.match(/a=rtpmap:(\d+) red\/48000\/2/i);
    if (!opusMatch || !redMatch) {
      return sdp;
    }

    const opusPayloadType = opusMatch[1];
    const redPayloadType = redMatch[1];
    const mAudioRegex = /(m=audio\s\d+\s[A-Z/]+\s)(.*)/;
    const mAudioMatch = sdp.match(mAudioRegex);
    if (!mAudioMatch) return sdp;

    const payloadTypes = mAudioMatch[2]
      .split(' ')
      .filter((payloadType) => payloadType !== redPayloadType);
    const opusIndex = payloadTypes.indexOf(opusPayloadType);
    payloadTypes.splice(opusIndex >= 0 ? opusIndex : 0, 0, redPayloadType);

    return sdp.replace(mAudioRegex, `${mAudioMatch[1]}${payloadTypes.join(' ')}`);
  }
  private async handleMessage(data: any) {
    
    switch (data.type) {
      case 'participants':
        this.iceServers = Array.isArray(data.ice_servers) ? data.ice_servers : [];

        // Передаем список участников в store
        if (this.onParticipantsReceivedCallback) {
          this.onParticipantsReceivedCallback(data.participants);
        }
        // Обновляем локальный справочник участников
        try {
          this.participantDirectory.clear();
          for (const p of data.participants) {
            this.participantDirectory.set(p.user_id, { username: p.username, avatar_url: p.avatar_url });
          }
        } catch {}

        // Проверяем, есть ли среди участников те, кто уже демонстрирует экран
        // (для синхронизации состояния с поздними участниками)
        const currentUserId = this.getCurrentUserId();
        for (const participant of data.participants) {
          // Проверяем, демонстрирует ли участник экран
          if (participant.user_id !== currentUserId && participant.is_sharing_screen) {
            console.log('🖥️ Поздний участник: пользователь', participant.user_id, 'демонстрирует экран, синхронизируем состояние');

            // Симулируем событие screen_share_started для позднего участника
            const screenShareStartEvent = new CustomEvent('screen_share_start', {
              detail: {
                user_id: participant.user_id,
                username: participant.username,
                avatar_url: participant.avatar_url
              }
            });
            if (typeof window !== 'undefined') {
              window.dispatchEvent(screenShareStartEvent);
            }

            if (this.onScreenShareChanged) {
              this.onScreenShareChanged(participant.user_id, true);
            }
          }
        }

        // Создаем соединения с существующими участниками (кроме себя)
        for (const participant of data.participants) {
          if (participant.user_id !== currentUserId) {

            const shouldCreateOffer = currentUserId !== null && currentUserId < participant.user_id;
            await this.createPeerConnection(participant.user_id, shouldCreateOffer);
          }
        }
        break;

      case 'user_joined_voice':
        console.log('🔊 [VoiceService] Получено событие user_joined_voice:', data);
        console.log('🔊 [VoiceService] Текущий user_id:', this.getCurrentUserId(), 'Текущий voiceChannelId:', this.voiceChannelId);
        
        try {
          this.participantDirectory.set(data.user_id, { username: data.username, avatar_url: data.avatar_url });
        } catch {}
        
        // Воспроизводим звук подключения только если это не мы сами И мы находимся в том же канале
        const currentUserId2 = this.getCurrentUserId();
        if (data.user_id !== currentUserId2 && this.voiceChannelId === data.voice_channel_id) {
          console.log('🔊 [VoiceService] Воспроизводим звук подключения для пользователя', data.user_id);
          soundService.playJoinSound();
        } else {
          console.log('🔊 [VoiceService] НЕ воспроизводим звук:', {
            isCurrentUser: data.user_id === currentUserId2,
            isSameChannel: this.voiceChannelId === data.voice_channel_id,
            receivedChannelId: data.voice_channel_id,
            ourChannelId: this.voiceChannelId
          });
        }
        
        if (this.onParticipantJoined) {
          console.log('🔊 [VoiceService] Вызываем onParticipantJoined для пользователя', data.user_id);
          this.onParticipantJoined({
            user_id: data.user_id,
            username: data.username,
            display_name: data.display_name,
            avatar_url: data.avatar_url,
            is_muted: data.is_muted,
            is_deafened: data.is_deafened
          });
        } else {
          console.warn('🔊 [VoiceService] onParticipantJoined НЕ ЗАРЕГИСТРИРОВАН! Пользователь не будет добавлен в UI');
        }
        
        // Создаем соединение только если это не мы сами
        if (data.user_id !== currentUserId2) {
          // Создаем offer только если наш ID меньше (существующий пользователь создает offer для нового)
          const shouldCreateOffer = currentUserId2 !== null && currentUserId2 < data.user_id;
          console.log('🔊 [VoiceService] Создаем peer connection для пользователя', data.user_id, 'shouldCreateOffer:', shouldCreateOffer);
          await this.createPeerConnection(data.user_id, shouldCreateOffer);
        }
        break;

      case 'user_left_voice':
        console.log('🔊 Пользователь покинул голосовой канал:', data.user_id);
        
        // Воспроизводим звук отключения только если это не мы сами И мы находимся в том же канале
        const currentUserId3 = this.getCurrentUserId();
        if (data.user_id !== currentUserId3 && this.voiceChannelId === data.voice_channel_id) {
          soundService.playLeaveSound();
        }
        
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
        // Свою обводку управляем по факту отправки аудио, не по эху с сервера
        if (data.user_id === useAuthStore.getState().user?.id) break;
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

      case 'participant_status_changed':
        console.log('🔊 Статус участника изменен:', data.user_id, data.status);
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, data.status);
        }
        break;

      case 'screen_share_started':
        console.log('🖥️ Пользователь начал демонстрацию экрана:', data.user_id);
        
        // Генерируем событие для UI
        const screenShareStartEvent = new CustomEvent('screen_share_start', { 
          detail: { 
            user_id: data.user_id, 
            username: data.username,
            avatar_url: data.avatar_url 
          } 
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(screenShareStartEvent);
        }
        console.log('🖥️ Отправлено событие screen_share_start для UI');
        
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, true);
        }
        break;

      case 'screen_share_stopped':
        console.log('🖥️ Пользователь остановил демонстрацию экрана:', data.user_id);
        
        // Генерируем событие для UI
        const screenShareStopEvent = new CustomEvent('screen_share_stop', { 
          detail: { 
            user_id: data.user_id, 
            username: data.username 
          } 
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(screenShareStopEvent);
        }
        console.log('🖥️ Отправлено событие screen_share_stop для UI');
        
        // Удаляем видео элемент
        const videoElement = document.getElementById(`remote-video-${data.user_id}`);
        if (videoElement) {
          videoElement.remove();
        }
        
        // Скрываем контейнер если больше нет демонстраций экрана
        const videoContainer = document.getElementById('screen-share-container-chat');
        if (videoContainer && videoContainer.children.length === 0) {
          videoContainer.style.display = 'none';
          console.log('🖥️ Контейнер скрыт, так как нет активных демонстраций экрана');
        }
        
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, false);
        }
        break;

      case 'ping':
        // Автоматически отвечаем на ping
        this.sendMessage({ type: 'pong' });
        break;

      default:
        console.log('🔊 Неизвестное сообщение:', data);
    }
  }

  private async createPeerConnection(userId: number, createOffer: boolean) {
    const existingPeer = this.peerConnections.get(userId)?.pc;
    if (existingPeer && existingPeer.connectionState !== 'closed' && existingPeer.connectionState !== 'failed') {
      return;
    }
    if (existingPeer) {
      this.removePeerConnection(userId);
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });
    
    // Добавляем обработчики событий для отладки и адаптивного качества
    pc.oniceconnectionstatechange = () => {
      // Адаптируем качество при изменении состояния ICE соединения
      this.adjustVideoQuality(pc, userId, false);
    };
    
    pc.onicegatheringstatechange = () => {
    };
    
    pc.onconnectionstatechange = () => {
      // Адаптируем качество при изменении состояния соединения
      this.adjustVideoQuality(pc, userId, false);
    };
    
    pc.onsignalingstatechange = () => {
    };

    // Добавляем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
      
      // Настраиваем адаптивное качество для видео треков
      await this.adjustVideoQuality(pc, userId, false);
    }

    // Если мы УЖЕ демонстрируем экран, добавим screenShare треки и инициируем переговоры
    if (this.isScreenSharing && this.screenStream) {
      try {
        await this.updatePeerConnectionForScreenShare(pc, userId);
      } catch (e) {
        console.warn(`🖥️ Не удалось сразу добавить screen share для нового соединения с пользователем ${userId}:`, e);
      }
    }

    // Обработка входящего потока
    pc.ontrack = (event) => {

      
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();

        // Обрабатываем аудио треки
        if (audioTracks.length > 0) {
      
          audioTracks.forEach((track, index) => {
       
          });
          
          let remoteAudio = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement | null;
          if (!remoteAudio) {
            remoteAudio = new Audio();
            remoteAudio.id = `remote-audio-${userId}`;
            remoteAudio.autoplay = true;
            remoteAudio.controls = false;
            remoteAudio.style.display = 'none';
            document.body.appendChild(remoteAudio);
          }
          remoteAudio.srcObject = new MediaStream(audioTracks);
          remoteAudio.muted = this.isDeafened;
          // Общая громкость вывода (по умолчанию 100%) × персональная громкость участника
          const outputVolume = (useAudioDeviceStore.getState().outputVolume ?? 100) / 100;
          const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
          const participantVolume = savedVolume
            ? Math.min(Math.max(Number.parseInt(savedVolume, 10) || 100, 0), 100) / 100
            : 1;
          remoteAudio.volume = Math.min(1, Math.max(0, outputVolume * participantVolume));
          
          // Пытаемся воспроизвести аудио
          const playPromise = remoteAudio.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
             
            }).catch(error => {
             
              
              // Показываем уведомление пользователю о необходимости разрешить аудио
              this.showAudioPermissionNotification(userId);
              
              const enableAudio = () => {
                remoteAudio.play().then(() => {
                  console.log('🔊 Аудио от пользователя', userId, 'включено после взаимодействия пользователя');
                  this.hideAudioPermissionNotification();
                  document.removeEventListener('click', enableAudio);
                  document.removeEventListener('touchstart', enableAudio);
                  document.removeEventListener('keydown', enableAudio);
                }).catch(e => {
                  console.error('🔊 Все еще не удается воспроизвести аудио от пользователя', userId, ':', e);
                });
              };
              
              // Добавляем больше событий для активации аудио
              document.addEventListener('click', enableAudio, { once: true });
              document.addEventListener('touchstart', enableAudio, { once: true });
              document.addEventListener('keydown', enableAudio, { once: true });
              
              // Также пытаемся активировать через пользовательские жесты
              setTimeout(() => {
                if (remoteAudio.paused) {
                  console.log('🔊 Пытаемся активировать аудио через программный клик');
                  document.body.click();
                }
              }, 1000);
            });
          }
        }

        // Обрабатываем видео треки (демонстрация экрана)
        if (videoTracks.length > 0) {
          console.log('🖥️ Получен видео поток от пользователя', userId);
          
          // Создаем или обновляем видео элемент
          let remoteVideo = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement;
          if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = `remote-video-${userId}`;
            remoteVideo.autoplay = true;
            remoteVideo.controls = false;
            remoteVideo.muted = true; // Видео всегда без звука, звук идет через аудио элемент
            // Помогает мобильным браузерам и iOS не открывать полноэкранный режим
            // @ts-ignore
            remoteVideo.playsInline = true;
            // Используем относительное позиционирование и блочное отображение,
            // чтобы не перекрывать плейсхолдер и корректно занимать контейнер
            remoteVideo.style.position = 'relative';
            remoteVideo.style.display = 'block';
            remoteVideo.style.width = '100%';
            remoteVideo.style.height = '100%';
            remoteVideo.style.objectFit = 'contain';
            remoteVideo.style.backgroundColor = '#000';
            remoteVideo.style.zIndex = '2';
          // Запрашиваем 60fps при воспроизведении где поддерживается
          try {
            // @ts-ignore
            remoteVideo.playbackRate = 1.0;
          } catch {}
            
            // Добавляем обработчик загрузки видео
            remoteVideo.addEventListener('loadeddata', () => {
              console.log(`🖥️ Видео загружено для пользователя ${userId}`);
            });
            
            remoteVideo.addEventListener('error', (e) => {
              console.error(`🖥️ Ошибка загрузки видео для пользователя ${userId}:`, e);
            });
            
            // Ждем появления контейнера в ScreenShareViewer
            const waitForRemoteContainer = (attempts = 0): void => {
              const videoContainer = document.getElementById('screen-share-container-chat');

              if (videoContainer) {
                // Убираем плейсхолдеры не-видео, чтобы видео стало видно
                try {
                  Array.from(videoContainer.children).forEach((child) => {
                    if (!(child instanceof HTMLVideoElement)) {
                      child.remove();
                    }
                  });
                } catch {}
                if (!videoContainer.contains(remoteVideo)) {
                  videoContainer.appendChild(remoteVideo);
                }
                console.log(`🖥️ Видео элемент добавлен в ScreenShareViewer для пользователя ${userId}.`, {
                  width: videoContainer.offsetWidth,
                  height: videoContainer.offsetHeight
                });
              } else if (attempts < 200) { // ждем до ~20с
                setTimeout(() => waitForRemoteContainer(attempts + 1), 100);
              } else {
                console.error(`🖥️ Контейнер для демонстрации экрана не найден (user ${userId}). Отмена.`);
                remoteVideo.remove();
                return;
              }
            };

            // Также используем MutationObserver для отслеживания появления контейнера
            const observer = new MutationObserver((mutations) => {
              mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                  if (node instanceof HTMLElement && node.id === 'screen-share-container-chat') {
                    console.log(`🖥️ MutationObserver нашел контейнер для пользователя ${userId}`);
                    observer.disconnect();
                    waitForRemoteContainer();
                  }
                });
              });
            });

            // Начинаем наблюдение за изменениями в body
            observer.observe(document.body, { childList: true, subtree: true });
            
            waitForRemoteContainer();
          }
          
          // Используем исходный MediaStream от ontrack, чтобы избежать проблем с воспроизведением у поздних подключившихся
          const initialStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream(videoTracks);
          remoteVideo.srcObject = initialStream;

          // Для поздних подключившихся просим у отправителя ключевой кадр
          try {
            const videoReceiver = pc.getReceivers().find(r => r.track && r.track.kind === 'video');
            const rq = (videoReceiver && (videoReceiver as any).requestKeyFrame) ? (videoReceiver as any).requestKeyFrame.bind(videoReceiver) : null;
            if (rq) {
              rq();
              // Повторяем запрос несколько раз, пока не появятся размеры видео
              let attempts = 0;
              const kfTimer = (typeof window !== 'undefined' ? window : globalThis).setInterval(() => {
                attempts += 1;
                if ((remoteVideo.videoWidth && remoteVideo.videoWidth > 0) || attempts >= 8) {
                  clearInterval(kfTimer);
                } else {
                  try { rq(); } catch {}
                }
              }, 1000);

              // Также подписываемся на unmute для receiver.track (часто именно он размуляется позже)
              try {
                const rxTrack = (videoReceiver as any)?.track as MediaStreamTrack | undefined;
                if (rxTrack) {
                  rxTrack.addEventListener('unmute', () => {
                    try { (safePlay as any)(); } catch {}
                  }, { once: true });
                }
              } catch {}
            }
          } catch {}

          // Некоторые браузеры отправляют сначала "muted" видеотрек, который потом размуляется.
          // Для поздних подключившихся дождёмся события unmute и ещё раз инициируем проигрывание.
          try {
            videoTracks.forEach((track) => {
              if ((track as any).muted || track.enabled === false) {
                track.addEventListener('unmute', () => {
                  // Обновим srcObject на случай смены составов стрима и снова попробуем воспроизведение
                  const currentStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([track]);
                  remoteVideo.srcObject = currentStream;
                  // Безопасный запуск воспроизведения (функция определена ниже)
                  try { (safePlay as any)(); } catch {}
                }, { once: true });
              }
            });
          } catch {}

          // Если по-прежнему нет кадров (readyState=0), запускаем короткий watchdog:
          // периодически просим ключевой кадр и пробуем безопасно воспроизвести.
          try {
            const start = Date.now();
            const videoReceiver = pc.getReceivers().find(r => r.track && r.track.kind === 'video');
            const rq = (videoReceiver && (videoReceiver as any).requestKeyFrame) ? (videoReceiver as any).requestKeyFrame.bind(videoReceiver) : null;
            const watchdog = (typeof window !== 'undefined' ? window : globalThis).setInterval(() => {
              if (remoteVideo.videoWidth > 0 || Date.now() - start > 8000) {
                clearInterval(watchdog);
                return;
              }
              try { (safePlay as any)(); } catch {}
              try { if (rq) rq(); } catch {}
            }, 600);
          } catch {}

          // Гарантируем запуск воспроизведения только когда элемент присоединён к DOM контейнеру
          const safePlay = () => {
            const container = document.getElementById('screen-share-container-chat');
            if (!remoteVideo.isConnected || !container || !container.contains(remoteVideo)) {
              return; // Не пытаемся воспроизводить, пока элемент не в DOM контейнере
            }
            const p = remoteVideo.play();
            if (p && typeof p.then === 'function') {
              p.then(() => {
                console.log('🖥️ Воспроизведение видео удаленного экрана запущено');
              }).catch((e: any) => {
                console.warn('🖥️ Не удалось автовоспроизвести экран, повторим позже:', e);
                setTimeout(() => {
                  safePlay();
                }, 300);
              });
            }
          };

          remoteVideo.addEventListener('loadedmetadata', safePlay);
          remoteVideo.addEventListener('canplay', safePlay);

          // Watchdog: если элемент внезапно удалён (при ре-рендерах React), пере-добавляем его
          const watchdogInterval = (typeof window !== 'undefined' ? window : globalThis).setInterval(() => {
            if (!document.body.contains(remoteVideo)) {
              const container = document.getElementById('screen-share-container-chat');
              if (container) {
                try {
                  container.appendChild(remoteVideo);
                  safePlay();
                } catch {}
              }
            }
          }, 500);

          // Очищаем watchdog когда видеотрек закончится
          try {
            videoTracks.forEach((t) => {
              t.addEventListener('ended', () => {
                clearInterval(watchdogInterval);
              });
            });
          } catch {}

          // Уведомляем UI о начале демонстрации экрана (для поздних присоединившихся)
          try {
            const info = this.participantDirectory.get(userId);
            const evt = new CustomEvent('screen_share_start', {
              detail: {
                user_id: userId,
                username: info?.username,
                avatar_url: info?.avatar_url
              }
            });
            if (typeof window !== 'undefined') {
              window.dispatchEvent(evt);
            }
          } catch {}

          // Уведомляем store/слушателей
          if (this.onScreenShareChanged) {
            this.onScreenShareChanged(userId, true);
          }

          // Следим за завершением видео, чтобы корректно закрыть UI
          try {
            videoTracks.forEach((t) => {
              t.addEventListener('ended', () => {
                const stopEvt = new CustomEvent('screen_share_stop', {
                  detail: { user_id: userId, username: this.participantDirectory.get(userId)?.username }
                });
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(stopEvt);
                }
                if (this.onScreenShareChanged) {
                  this.onScreenShareChanged(userId, false);
                }
              });
            });
          } catch {}
          
          console.log('🖥️ Видео элемент создан для пользователя', userId);
        }
      }
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

    // Обработка состояния соединения
    this.peerConnections.set(userId, { pc, userId });

    if (createOffer) {

      const offer = await pc.createOffer();
      // Внедряем RED в offer SDP
      if (offer.sdp) {
        offer.sdp = this.enableOpusRed(offer.sdp);
      }
      await pc.setLocalDescription(offer);
      this.sendMessage({
        type: 'offer',
        target_id: userId,
        offer: pc.localDescription,
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
      // Избегаем glare: если у нас уже есть локальный offer, откатываемся
      if (peerConnection.pc.signalingState === 'have-local-offer') {
        try {
          // @ts-ignore — rollback тип отсутствует в TS типах
          await peerConnection.pc.setLocalDescription({ type: 'rollback' });
          console.log('🔊 Выполнен rollback локального offer из-за встречного offer');
        } catch (e) {
          console.warn('🔊 Не удалось выполнить rollback:', e);
        }
      }
      
      await peerConnection.pc.setRemoteDescription(offer);
      console.log(`🔊 Установлен remote description для пользователя ${userId}`);
      
      const answer = await peerConnection.pc.createAnswer();
      // Внедряем RED в answer SDP
      if (answer.sdp) {
        answer.sdp = this.enableOpusRed(answer.sdp);
      }
      await peerConnection.pc.setLocalDescription(answer);
      console.log(`🔊 Создан и установлен answer для пользователя ${userId}:`, answer);

      // После установки remoteDescription применяем отложенные ICE кандидаты
      const queued = this.pendingIceCandidates.get(userId);
      if (queued && queued.length > 0) {
        for (const cand of queued) {
          try {
            await peerConnection.pc.addIceCandidate(cand);
          } catch (e) {
            console.warn(`🔊 Не удалось применить отложенный ICE candidate для ${userId}:`, e);
          }
        }
        this.pendingIceCandidates.delete(userId);
      }

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
        // Защита от некорректного состояния: answer принимаем только когда есть локальный offer
        if (peerConnection.pc.signalingState !== 'have-local-offer') {
          console.warn(`🔊 Пропускаем answer от ${userId} — текущее signalingState=${peerConnection.pc.signalingState}`);
          return;
        }
        await peerConnection.pc.setRemoteDescription(answer);
        // После установки remoteDescription применяем отложенные ICE кандидаты
        const queued = this.pendingIceCandidates.get(userId);
        if (queued && queued.length > 0) {
          for (const cand of queued) {
            try {
              await peerConnection.pc.addIceCandidate(cand);
            } catch (e) {
              console.warn(`🔊 Не удалось применить отложенный ICE candidate для ${userId}:`, e);
            }
          }
          this.pendingIceCandidates.delete(userId);
        }
      } catch (error) {
        console.error(`🔊 Ошибка при обработке answer от пользователя ${userId}:`, error);
      }
    } else {
      console.error(`🔊 Не найдено peer connection для пользователя ${userId}`);
    }
  }

  private async handleIceCandidate(userId: number, candidate: RTCIceCandidateInit) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      try {
        // Если remoteDescription ещё не установлен — буферизуем кандидата
        if (!peerConnection.pc.remoteDescription) {
          const list = this.pendingIceCandidates.get(userId) || [];
          list.push(candidate);
          this.pendingIceCandidates.set(userId, list);
          return;
        }
        await peerConnection.pc.addIceCandidate(candidate);
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
    this.pendingIceCandidates.delete(userId);
    this.speakingUsers.delete(userId);
    this.onSpeakingChanged?.(userId, false);
    
    // Удаляем аудио элемент из DOM
    const audioElement = document.getElementById(`remote-audio-${userId}`);
    if (audioElement) {
      audioElement.remove();
      console.log(`🔊 Удален аудио элемент для пользователя ${userId}`);
    }

    // Удаляем видео элемент из DOM
    const videoElement = document.getElementById(`remote-video-${userId}`);
    if (videoElement) {
      videoElement.remove();
      console.log(`🖥️ Удален видео элемент для пользователя ${userId}`);
      
      // Уведомляем об остановке демонстрации экрана
      if (this.onScreenShareChanged) {
        this.onScreenShareChanged(userId, false);
      }
    }
  }

  private sendMessage(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const messageStr = JSON.stringify(data);
      console.log('[VoiceService] Отправка сообщения:', messageStr);
      this.ws.send(messageStr);
    } else {
      console.warn('[VoiceService] WebSocket не открыт, сообщение не отправлено:', {
        type: data.type,
        ws: !!this.ws,
        readyState: this.ws?.readyState,
        OPEN: WebSocket.OPEN
      });
    }
  }

  /** Громкость своего микрофона (0–100). По умолчанию 100. */
  setInputVolume(percent: number) {
    audioProcessingService.setInputVolume(percent);
  }

  /** Громкость всех входящих голосов (0–100). По умолчанию 100. */
  setOutputVolume(percent: number) {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));
    useAudioDeviceStore.getState().setOutputVolume(clamped);
    const outputFactor = clamped / 100;

    if (typeof document === 'undefined') return;
    document.querySelectorAll<HTMLAudioElement>('[id^="remote-audio-"]').forEach((audio) => {
      const userId = audio.id.replace('remote-audio-', '');
      const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
      const participantFactor = savedVolume
        ? Math.min(Math.max(Number.parseInt(savedVolume, 10) || 100, 0), 100) / 100
        : 1;
      audio.volume = Math.min(1, Math.max(0, outputFactor * participantFactor));
    });
  }

  setMuted(muted: boolean) {
    this.isMuted = muted;
    // Используем audio processing service для управления mute
    audioProcessingService.setMuted(muted);
    
    // КРИТИЧНО: Отключаем треки на уровне WebRTC
    // Это останавливает отправку RTP пакетов (как в Discord!)
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
    
    // Также останавливаем отправку через RTCRtpSender
    this.peerConnections.forEach(({ pc }) => {
      const audioSenders = pc.getSenders().filter(s => s.track?.kind === 'audio');
      audioSenders.forEach(sender => {
        if (sender.track) {
          sender.track.enabled = !muted;
        }
      });
    });
    
    // Отправляем сообщение на сервер
    this.sendMessage({ type: 'mute', is_muted: muted });

    if (muted) {
      this.setLocalSpeechDetected(false);
    }
    
    console.log(`🎙️ Микрофон ${muted ? 'заглушен' : 'включен'} - RTP пакеты ${muted ? 'НЕ отправляются' : 'отправляются'} (как в Discord!)`);
  }

  setDeafened(deafened: boolean) {
    this.isDeafened = deafened;
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

  // Обновление аудио настроек
  async updateAudioSettings(settings: {
    noiseSuppression?: boolean;
    echoCancellation?: boolean;
    autoGainControl?: boolean;
  }): Promise<void> {
    console.log('🔄 Обновление аудио настроек:', settings);

    audioProcessingService.updateConfig({
      ...(settings.echoCancellation === undefined
        ? {}
        : { echoCancellation: settings.echoCancellation }),
      ...(settings.autoGainControl === undefined
        ? {}
        : { autoGainControl: settings.autoGainControl }),
    });

    if (settings.noiseSuppression !== undefined) {
      const noiseSuppressionStore = useNoiseSuppressionStore.getState();
      noiseSuppressionStore.setEnabled(settings.noiseSuppression);
      await audioProcessingService.setNoiseSuppression(
        settings.noiseSuppression,
        noiseSuppressionStore.engine
      );
    }
  }

  // Пересоздание медиа потока с новыми настройками
  private async recreateMediaStream(settings: {
    noiseSuppression?: boolean;
    echoCancellation?: boolean;
    autoGainControl?: boolean;
  }): Promise<void> {
    try {
      console.log('🔄 Пересоздаем медиа поток с новыми настройками...');

      // Останавливаем текущий поток
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
      }

      // Создаем новый поток с новыми настройками
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: settings.echoCancellation ?? true,
          noiseSuppression: settings.noiseSuppression ?? true,
          autoGainControl: settings.autoGainControl ?? true,
        },
        video: false,
      });

      this.localStream = newStream;

      // Обновляем треки во всех peer connections
      this.peerConnections.forEach(({ pc }) => {
        // Удаляем старые аудио треки
        const senders = pc.getSenders();
        senders.forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            pc.removeTrack(sender);
          }
        });

        // Добавляем новые аудио треки
        newStream.getAudioTracks().forEach(track => {
          pc.addTrack(track, newStream);
        });
      });

      console.log('✅ Медиа поток пересоздан с новыми настройками');
    } catch (error) {
      console.error('❌ Ошибка пересоздания медиа потока:', error);
    }
  }

  onParticipantJoin(callback: (participant: any) => void) {
    console.log('🔊 [VoiceService] onParticipantJoin зарегистрирован');
    this.onParticipantJoined = callback;
  }

  onParticipantLeave(callback: (userId: number) => void) {
    this.onParticipantLeft = callback;
  }

  disconnect() {
    console.log('🎙️ VoiceService.disconnect вызван');
    console.log('🎙️ Текущее состояние ws:', this.ws ? this.ws.readyState : 'null');
    console.log('🎙️ Текущий voiceChannelId:', this.voiceChannelId);
    
    // Сохраняем ссылку на WebSocket для закрытия
    const wsToClose = this.ws;
    
    // Вызываем cleanup
    this.cleanup();
    
    // Дополнительная проверка - если WebSocket всё ещё существует
    if (wsToClose && wsToClose.readyState !== WebSocket.CLOSED) {
      console.warn('🎙️ WebSocket не закрылся после cleanup, пробуем ещё раз');
      try {
        wsToClose.close();
      } catch (e) {
        console.error('🎙️ Ошибка при дополнительном закрытии:', e);
      }
    }
  }

  private cleanup() {
    console.log('🔊 Очистка VoiceService');
    
    // Очищаем аудио обработку
    audioProcessingService.destroy();
    
    // Очищаем все обработчики событий
    this.onParticipantJoined = null;
    this.onParticipantLeft = null;
    this.onSpeakingChanged = null;
    this.onParticipantsReceivedCallback = null;
    this.onParticipantStatusChangedCallback = null;
    this.onScreenShareChanged = null;
    
    // Закрываем все peer connections
    this.peerConnections.forEach(({ pc, userId }) => {
      pc.close();
      // Удаляем соответствующий аудио элемент
      const audioElement = document.getElementById(`remote-audio-${userId}`);
      if (audioElement) {
        audioElement.remove();
      }
      // Удаляем соответствующий видео элемент
      const videoElement = document.getElementById(`remote-video-${userId}`);
      if (videoElement) {
        videoElement.remove();
        console.log(`🖥️ Удален видео элемент для пользователя ${userId} при cleanup`);
      }
    });
    this.peerConnections.clear();
    this.pendingIceCandidates.clear();
    this.participantDirectory.clear();
    this.speakingUsers.clear();
    this.removePTTHandlers();
    this.hideAudioPermissionNotification();

    // Останавливаем потоки демонстрации экрана
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }
    this.isScreenSharing = false;


    // Удаляем все возможные видео элементы которые могли остаться
    document.querySelectorAll('video[id^="remote-video-"]').forEach(video => {
      video.remove();
      console.log('🖥️ Удален остаточный видео элемент:', video.id);
    });

    // Останавливаем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    if (this.rawInputStream) {
      this.rawInputStream.getTracks().forEach(track => track.stop());
      this.rawInputStream = null;
    }

    // Очищаем VAD
    this.cleanupVoiceActivityDetection();

    // Закрываем WebSocket если открыт
    if (this.ws) {
      console.log('🔊 Закрываем WebSocket соединение. Текущее состояние:', this.ws.readyState);
      
      const wsToClose = this.ws;
      
      // Сразу обнуляем ссылку, чтобы предотвратить повторное использование
      this.ws = null;
      
      // Удаляем обработчики событий
      wsToClose.onopen = null;
      wsToClose.onmessage = null;
      wsToClose.onerror = null;
      wsToClose.onclose = null;
      
      // Закрываем соединение
      try {
        console.log('🔊 Вызываем ws.close()...');
        wsToClose.close(1000, 'User disconnected');
        console.log('🔊 ws.close() вызван успешно');
        
        // Проверяем состояние через 100мс
        setTimeout(() => {
          console.log('🔊 Состояние WebSocket через 100мс:', wsToClose.readyState);
          if (wsToClose.readyState !== WebSocket.CLOSED) {
            console.warn('🔊 WebSocket всё ещё не закрыт, пытаемся закрыть принудительно');
            try {
              wsToClose.close();
            } catch (e) {
              console.error('🔊 Ошибка при повторном закрытии:', e);
            }
          }
        }, 100);
      } catch (error) {
        console.error('🔊 Ошибка при закрытии WebSocket:', error);
      }
    }

    this.voiceChannelId = null;
    this.token = null;
  }

  // Методы для детекции голосовой активности
  private initVoiceActivityDetection() {
    if (!this.localStream) return;

    try {
      if (typeof window === 'undefined') return;
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

    this.vadInterval = (typeof window !== 'undefined' ? window : globalThis).setInterval(() => {
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
        
        // Используем настраиваемые пороги из VAD настроек
        const totalThreshold = this.vadThresholds?.total || 25;
        const midThreshold = this.vadThresholds?.mid || 20;
        const maxThreshold = this.vadThresholds?.max || 30;
        
        // В режиме PTT не используем автоматическую детекцию голоса
        if (this.inputMode === 'push-to-talk') {
          return; // Выходим из функции, так как PTT управляется клавишами
        }
        
        // Считаем что говорим если превышен любой из порогов
        const currentlySpeaking = 
          totalAverage > totalThreshold || 
          midAverage > midThreshold || 
          maxValue > maxThreshold;
        
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
    this.localSpeechDetected = false;
    this.stopOutboundAudioMonitor();
    this.applySpeakingIndicator(false);
    this.lastOutboundAudioBytes.clear();
    this.speakingUsers.clear();
  }

  /** Сразу обновляем свою зелёную обводку, не дожидаясь эха с сервера */
  private notifyLocalSpeaking(isSpeaking: boolean) {
    const userId = useAuthStore.getState().user?.id;
    if (!userId || !this.onSpeakingChanged) return;
    this.onSpeakingChanged(userId, isSpeaking);
  }

  /** Есть ли хотя бы один собеседник с установленным аудио-соединением */
  private hasConnectedAudioPeer(): boolean {
    if (this.isMuted || this.isDeafened) return false;

    const audioTrack = this.localStream?.getAudioTracks()[0];
    if (!audioTrack?.enabled || audioTrack.readyState !== 'live') return false;

    for (const { pc } of Array.from(this.peerConnections.values())) {
      if (pc.connectionState !== 'connected') continue;
      const hasEnabledAudioSender = pc
        .getSenders()
        .some((sender) => sender.track?.kind === 'audio' && sender.track.enabled);
      if (hasEnabledAudioSender) return true;
    }

    return false;
  }

  private async seedOutboundBytesBaseline(): Promise<void> {
    for (const { pc, userId } of Array.from(this.peerConnections.values())) {
      if (pc.connectionState !== 'connected') continue;

      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'audio') {
            this.lastOutboundAudioBytes.set(userId, report.bytesSent ?? 0);
          }
        });
      } catch {
        // ignore transient stats errors
      }
    }
  }

  private startOutboundAudioMonitor(): void {
    if (this.outboundStatsTimer) return;

    this.outboundStatsTimer = setInterval(() => {
      void this.pollOutboundAudio();
    }, 120);
  }

  private stopOutboundAudioMonitor(): void {
    if (!this.outboundStatsTimer) return;
    clearInterval(this.outboundStatsTimer);
    this.outboundStatsTimer = null;
  }

  /** Проверяем, что аудио-пакеты реально уходят собеседникам (WebRTC outbound-rtp). */
  private async pollOutboundAudio(): Promise<void> {
    if (this.isMuted || this.isDeafened || !this.localSpeechDetected) {
      this.applySpeakingIndicator(false);
      return;
    }

    if (!this.hasConnectedAudioPeer()) {
      this.applySpeakingIndicator(false);
      return;
    }

    let bytesIncreased = false;

    for (const { pc, userId } of Array.from(this.peerConnections.values())) {
      if (pc.connectionState !== 'connected') continue;

      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'audio') {
            const bytes = report.bytesSent ?? 0;
            const previous = this.lastOutboundAudioBytes.get(userId);
            if (previous !== undefined && bytes > previous) {
              bytesIncreased = true;
            }
            this.lastOutboundAudioBytes.set(userId, bytes);
          }
        });
      } catch {
        // ignore transient stats errors
      }
    }

    this.applySpeakingIndicator(bytesIncreased);
  }

  private setLocalSpeechDetected(detected: boolean): void {
    if (this.localSpeechDetected === detected) return;
    this.localSpeechDetected = detected;

    if (detected) {
      void this.seedOutboundBytesBaseline().then(() => {
        if (this.localSpeechDetected) {
          this.startOutboundAudioMonitor();
        }
      });
      return;
    }

    this.stopOutboundAudioMonitor();
    this.applySpeakingIndicator(false);
  }

  /** Обводка и событие для других — только когда голос реально ушёл по WebRTC */
  private applySpeakingIndicator(active: boolean): void {
    if (this.speakingIndicatorActive === active) return;

    this.speakingIndicatorActive = active;
    this.isSpeaking = active;
    this.notifyLocalSpeaking(active);
    this.sendMessage({
      type: 'speaking',
      is_speaking: active,
    });
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

  onConnectionStateChange(callback: (state: 'connected' | 'disconnected' | 'error', message?: string) => void) {
    this.onConnectionStateChanged = callback;
  }

  // Демонстрация экрана
  async startScreenShare(): Promise<boolean> {
    try {
      console.log('🖥️ Начинаем демонстрацию экрана');
      
      // Проверяем, не демонстрирует ли пользователь уже экран
      if (this.isScreenSharing) {
        console.log('🖥️ Пользователь уже демонстрирует экран');
        return false;
      }
      
      // Electron: используем desktopCapturer для выбора источника, как в Discord
      const isElectron = typeof window !== 'undefined' && !!window.electronAPI && typeof window.electronAPI.getDesktopSources === 'function';
      if (isElectron) {
        const sources: Array<{ id: string; name: string; type: string }> = await window.electronAPI!.getDesktopSources!({});
        // Выбираем основной экран
        const selected = sources.find((s: { id: string; name: string; type: string }) => s.type === 'screen' && /1|Primary|Главный/i.test(s.name))
          || sources.find((s: { id: string; name: string; type: string }) => s.type === 'screen')
          || sources[0];
        if (!selected) throw new Error('Не удалось получить список источников экрана');

        const buildConstraints = (withSystemAudio: boolean) => ({
          audio: withSystemAudio
            ? {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: selected.id,
                }
              }
            : false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: selected.id,
              maxFrameRate: 30,
              minFrameRate: 15,
              maxWidth: 1920,
              maxHeight: 1080,
            }
          } as any
        }) as MediaStreamConstraints;

        try {
          this.screenStream = await navigator.mediaDevices.getUserMedia(buildConstraints(true));
        } catch (e) {
          console.warn('🖥️ Не удалось получить системный звук, пробуем без аудио', e);
          this.screenStream = await navigator.mediaDevices.getUserMedia(buildConstraints(false));
        }

        // Валидация: убеждаемся, что получили настоящий MediaStream
        if (!this.screenStream || typeof (this.screenStream as any).getVideoTracks !== 'function') {
          console.warn('🖥️ Получен несовместимый объект вместо MediaStream. Пробуем getDisplayMedia как fallback');
          try {
            const gdm = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false
            } as any);
            this.screenStream = gdm as any;
          } catch (e) {
            console.error('🖥️ Fallback getDisplayMedia также не удался', e);
            throw e;
          }
        }
      } else {
        // Браузер: стандартный getDisplayMedia
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 60 },
            aspectRatio: { ideal: 16/9 }
          },
          audio: true
        });
      }

      // Обрабатываем событие остановки демонстрации экрана
      this.screenStream!.getVideoTracks()[0].addEventListener('ended', () => {
        console.log('🖥️ Демонстрация экрана остановлена пользователем');
        this.stopScreenShare();
      });

      // Обрабатываем событие остановки аудио трека
      const audioTracks = this.screenStream!.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].addEventListener('ended', () => {
          console.log('🖥️ Системный звук остановлен');
        });
      }

      // Добавляем видео трек ко всем существующим peer connections
      const updatePromises: Promise<void>[] = [];
      
      this.peerConnections.forEach(({ pc }, userId) => {
        const updatePromise = this.updatePeerConnectionForScreenShare(pc, userId);
        updatePromises.push(updatePromise);
      });

      // Ждем завершения всех обновлений
      try {
        await Promise.allSettled(updatePromises);
        console.log('🖥️ Все peer connections обновлены для демонстрации экрана');
      } catch (error) {
        console.error('🖥️ Ошибка при обновлении peer connections:', error);
      }

      // Создаем локальный видео элемент для стримера
      this.createLocalScreenShareVideo();

      this.isScreenSharing = true;
      
      // Уведомляем сервер о начале демонстрации экрана
      this.sendMessage({ 
        type: 'screen_share_start'
      });

      // Отправляем локальное событие для обновления UI
      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
        // Получаем имя пользователя из токена или используем "Вы"
        let username = 'Вы';
        try {
          if (this.token) {
            const payload = JSON.parse(atob(this.token.split('.')[1]));
            username = payload.username || 'Вы';
          }
        } catch (error) {
          console.warn('Не удалось получить имя пользователя из токена:', error);
        }
        
        const event = new CustomEvent('screen_share_start', {
          detail: { 
            user_id: currentUserId,
            username: username
          }
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(event);
        }
        console.log('🖥️ Отправлено локальное событие screen_share_start для пользователя:', currentUserId);
      }

      console.log('🖥️ Демонстрация экрана успешно начата');
      return true;
    } catch (error) {
      console.error('🖥️ Ошибка начала демонстрации экрана:', error);
      return false;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    console.log('🖥️ Останавливаем демонстрацию экрана');

    // Отправляем локальное событие для немедленного обновления UI
    const userId = this.getCurrentUserId();
    if (userId) {
      const event = new CustomEvent('screen_share_stop', {
        detail: { 
          user_id: userId
        }
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(event);
      }
      console.log('🖥️ Отправлено локальное событие screen_share_stop для пользователя:', userId);
    }

    // Останавливаем все треки
    this.screenStream.getTracks().forEach(track => {
      track.stop();
    });

    // Удаляем видео и системные аудио треки из всех peer connections
    const removePromises: Promise<void>[] = [];
    
    this.peerConnections.forEach(({ pc }, userId) => {
      const removePromise = this.removeScreenShareFromPeerConnection(pc, userId);
      removePromises.push(removePromise);
    });

    // Ждем завершения всех операций удаления
    Promise.allSettled(removePromises).then(() => {
      console.log('🖥️ Все peer connections обновлены после остановки демонстрации экрана');
    }).catch(error => {
      console.error('🖥️ Ошибка при обновлении peer connections:', error);
    });

    this.screenStream = null;
    this.isScreenSharing = false;

    // Удаляем локальный видео элемент
    const currentUserId = this.getCurrentUserId();
    if (currentUserId) {
      const localVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
      if (localVideo) {
        localVideo.remove();
        console.log('🖥️ Локальный видео элемент удален');
      }

      // Уведомляем об остановке демонстрации экрана для локального пользователя
      if (this.onScreenShareChanged) {
        this.onScreenShareChanged(currentUserId, false);
      }

      // Отправляем глобальное событие
      const event = new CustomEvent('screen_share_stop', {
        detail: { 
          user_id: currentUserId
        }
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(event);
      }
    }

    // Уведомляем сервер об остановке демонстрации экрана
    this.sendMessage({ 
      type: 'screen_share_stop'
    });

    console.log('🖥️ Демонстрация экрана остановлена');
  }

  // Вспомогательный метод для удаления screen share из peer connection
  private async removeScreenShareFromPeerConnection(pc: RTCPeerConnection, userId: number): Promise<void> {
    try {
      const senders = pc.getSenders();
      
      // Удаляем видео треки и системные аудио треки
      const removePromises: Promise<void>[] = [];
      
      senders.forEach((sender: RTCRtpSender) => {
        if (sender.track) {
          const track = sender.track;
          
          // Удаляем видео треки
          if (track.kind === 'video') {
            const removePromise = sender.replaceTrack(null).then(() => {
              console.log(`🖥️ Видео трек остановлен для пользователя ${userId}`);
            }).catch(error => {
              console.error(`🖥️ Ошибка остановки видео трека для пользователя ${userId}:`, error);
              // Если replaceTrack не работает, удаляем трек
              try {
                pc.removeTrack(sender);
                console.log(`🖥️ Видео трек удален альтернативным способом для пользователя ${userId}`);
              } catch (removeError) {
                console.error(`🖥️ Ошибка удаления видео трека для пользователя ${userId}:`, removeError);
              }
            });
            removePromises.push(removePromise);
          }
          
          // Удаляем системные аудио треки
          if (track.kind === 'audio' && (
            track.label.includes('System') || 
            track.label.includes('Desktop') ||
            track.label.includes('Entire')
          )) {
            const removePromise = sender.replaceTrack(null).then(() => {
              console.log(`🖥️ Системный аудио трек остановлен для пользователя ${userId}`);
            }).catch(error => {
              console.error(`🖥️ Ошибка остановки системного аудио трека для пользователя ${userId}:`, error);
              // Если replaceTrack не работает, удаляем трек
              try {
                pc.removeTrack(sender);
                console.log(`🖥️ Системный аудио трек удален альтернативным способом для пользователя ${userId}`);
              } catch (removeError) {
                console.error(`🖥️ Ошибка удаления системного аудио трека для пользователя ${userId}:`, removeError);
              }
            });
            removePromises.push(removePromise);
          }
        }
      });

      // Ждем завершения всех операций удаления треков
      await Promise.allSettled(removePromises);

      // Создаем новый offer без screen share только если connection активно
      if (pc.connectionState === 'connected' || pc.connectionState === 'new') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendMessage({
          type: 'offer',
          target_id: userId,
          offer: offer,
        });
        console.log(`🖥️ Отправлен offer без screen share для пользователя ${userId}`);
      } else {
        console.warn(`🖥️ Peer connection для пользователя ${userId} не готов для создания offer. Состояние: ${pc.connectionState}`);
      }
    } catch (error) {
      console.error(`🖥️ Ошибка при остановке демонстрации для пользователя ${userId}:`, error);
      throw error;
    }
  }

  getScreenSharingStatus(): boolean {
    return this.isScreenSharing;
  }

  onScreenShareChange(callback: (userId: number, isSharing: boolean) => void) {
    this.onScreenShareChanged = callback;

    return () => {
      if (this.onScreenShareChanged === callback) {
        this.onScreenShareChanged = null;
      }
    };
  }

  // Управление адаптивным качеством
  setAdaptiveQuality(enabled: boolean) {
    this.adaptiveQualityEnabled = enabled;
    console.log(`🔊 Адаптивное качество ${enabled ? 'включено' : 'отключено'}`);
  }

  // Принудительное обновление качества для всех соединений
  async updateAllVideoQuality() {
    if (!this.adaptiveQualityEnabled) return;
    
    this.peerConnections.forEach(async ({ pc }, userId) => {
      await this.adjustVideoQuality(pc, userId, this.isScreenSharing);
    });
  }

  // Адаптивное изменение качества в зависимости от состояния соединения
  private async adjustVideoQuality(pc: RTCPeerConnection, userId: number, isScreenShare: boolean = false): Promise<void> {
    if (!this.adaptiveQualityEnabled) return;
    
    try {
      const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (!videoSender) return;
      
      const parameters = videoSender.getParameters();
      if (!parameters.encodings || parameters.encodings.length === 0) return;
      
      // Определяем качество на основе состояния соединения
      const connectionState = pc.connectionState;
      const iceConnectionState = pc.iceConnectionState;
      
      let maxBitrate: number;
      let maxFramerate: number;
      
      if (isScreenShare) {
        // Для демонстрации экрана - более высокие требования
        if (connectionState === 'connected' && iceConnectionState === 'connected') {
          maxBitrate = 8_000_000; // 8 Mbps для отличного соединения
          maxFramerate = 30;
        } else if (connectionState === 'connecting' || iceConnectionState === 'checking') {
          maxBitrate = 4_000_000; // 4 Mbps для среднего соединения
          maxFramerate = 24;
        } else {
          maxBitrate = 2_000_000; // 2 Mbps для слабого соединения
          maxFramerate = 15;
        }
      } else {
        // Для обычного видео
        if (connectionState === 'connected' && iceConnectionState === 'connected') {
          maxBitrate = 2_000_000; // 2 Mbps для отличного соединения
          maxFramerate = 30;
        } else if (connectionState === 'connecting' || iceConnectionState === 'checking') {
          maxBitrate = 1_000_000; // 1 Mbps для среднего соединения
          maxFramerate = 24;
        } else {
          maxBitrate = 500_000; // 500 kbps для слабого соединения
          maxFramerate = 15;
        }
      }
      
      parameters.encodings[0].maxBitrate = maxBitrate;
      parameters.encodings[0].maxFramerate = maxFramerate;
      parameters.encodings[0].scaleResolutionDownBy = 1;
      
      await videoSender.setParameters(parameters);
      console.log(`🔊 Адаптивное качество для ${isScreenShare ? 'screen share' : 'video'}: ${maxBitrate/1000000} Mbps, ${maxFramerate} FPS`);
      
    } catch (e) {
      console.warn('🔊 Не удалось настроить адаптивное качество:', e);
    }
  }

  // Вспомогательный метод для обновления peer connection для демонстрации экрана
  private async updatePeerConnectionForScreenShare(pc: RTCPeerConnection, userId: number): Promise<void> {
    try {
      if (!this.screenStream) {
        console.error('🖥️ screenStream не доступен для обновления peer connection');
        return;
      }

      const videoTrack = this.screenStream.getVideoTracks()[0];
      const audioTracks = this.screenStream.getAudioTracks();
      
      if (!videoTrack) {
        console.error('🖥️ Видео трек не найден в screenStream');
        return;
      }

      // Получаем все senders
      const senders = pc.getSenders();
      const existingVideoSender = senders.find(sender => 
        sender.track && sender.track.kind === 'video'
      );
      const existingAudioSenders = senders.filter(sender => 
        sender.track && sender.track.kind === 'audio'
      );

      // Обновляем видео трек
      if (existingVideoSender) {
        // Заменяем существующий видео трек
        await existingVideoSender.replaceTrack(videoTrack);
        console.log(`🖥️ Заменен видео трек для пользователя ${userId}`);
      } else {
        // Добавляем новый видео трек
        pc.addTrack(videoTrack, this.screenStream);
        console.log(`🖥️ Добавлен видео трек для пользователя ${userId}`);
      }

      // Настраиваем адаптивное качество для демонстрации экрана
      await this.adjustVideoQuality(pc, userId, true);

      // Подсказка контента для улучшения качества движения
      try {
        // contentHint поддерживается в современных браузерах
        // @ts-ignore
        videoTrack.contentHint = 'motion';
      } catch {}

      // Обрабатываем системный аудио трек
      if (audioTracks.length > 0) {
        const systemAudioTrack = audioTracks[0];
        
        // Проверяем, что это действительно системный звук
        const isSystemAudio = systemAudioTrack.label.includes('System') || 
                             systemAudioTrack.label.includes('Desktop') ||
                             systemAudioTrack.label.includes('Entire') ||
                             systemAudioTrack.getSettings().deviceId !== 'default';
        
        if (isSystemAudio) {
          // Ищем существующий системный аудио sender
          const existingSystemAudioSender = existingAudioSenders.find(sender => {
            const track = sender.track;
            return track && track.kind === 'audio' && (
              track.label.includes('System') || 
              track.label.includes('Desktop') ||
              track.label.includes('Entire')
            );
          });

          if (existingSystemAudioSender) {
            // Заменяем существующий системный аудио трек
            await existingSystemAudioSender.replaceTrack(systemAudioTrack);
            console.log(`🖥️ Заменен системный аудио трек для пользователя ${userId}`);
          } else {
            // Добавляем новый системный аудио трек
            pc.addTrack(systemAudioTrack, this.screenStream);
            console.log(`🖥️ Добавлен системный аудио трек для пользователя ${userId}`);
          }
        }
      }

      // Создаем новый offer только если connection state позволяет
      if (pc.connectionState === 'connected' || pc.connectionState === 'new') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendMessage({
          type: 'offer',
          target_id: userId,
          offer: offer,
        });
        console.log(`🖥️ Отправлен offer с видео треком для пользователя ${userId}`);
      } else {
        console.warn(`🖥️ Peer connection для пользователя ${userId} не готов для создания offer. Состояние: ${pc.connectionState}`);
      }
    } catch (error) {
      console.error(`🖥️ Ошибка обновления peer connection для пользователя ${userId}:`, error);
      throw error;
    }
  }

  private createLocalScreenShareVideo() {
    if (!this.screenStream) return;

    console.log('🖥️ Создаем локальный видео элемент для стримера');

    // Получаем текущего пользователя
    const currentUserId = this.getCurrentUserId();
    if (!currentUserId) return;

    // Удаляем существующий локальный видео элемент если есть
    const existingVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
    if (existingVideo) {
      existingVideo.remove();
    }

    // Создаем новый видео элемент
    const localVideo = document.createElement('video');
    localVideo.id = `remote-video-${currentUserId}`;
    localVideo.autoplay = true;
    localVideo.controls = false;
    localVideo.muted = true; // Заглушаем чтобы избежать эха
    localVideo.style.position = 'absolute';
    localVideo.style.top = '0';
    localVideo.style.left = '0';
    localVideo.style.width = '100%';
    localVideo.style.height = '100%';
    localVideo.style.objectFit = 'contain';
    localVideo.style.backgroundColor = '#000';
    
    // Добавляем обработчики событий
    localVideo.addEventListener('loadeddata', () => {
      console.log('🖥️ Локальное видео загружено');
    });
    
    localVideo.addEventListener('error', (e) => {
      console.error('🖥️ Ошибка загрузки локального видео:', e);
    });
    
    // Устанавливаем поток
    localVideo.srcObject = this.screenStream;
    
    // Ждем появления контейнера в ChatArea (максимум 5 секунд)
    const waitForContainer = (attempts = 0): void => {
      const videoContainer = document.getElementById('screen-share-container-chat');
      
      if (videoContainer) {
        // Контейнер найден, добавляем видео
        videoContainer.innerHTML = '';
        videoContainer.appendChild(localVideo);
        console.log('🖥️ Локальный видео элемент добавлен в ChatArea. Контейнер размеры:', {
          width: videoContainer.offsetWidth,
          height: videoContainer.offsetHeight,
          style: videoContainer.style.cssText,
          videoSrc: localVideo.srcObject ? 'есть' : 'нет'
        });
        
        // Проверяем, что видео элемент действительно добавлен
        setTimeout(() => {
          const addedVideo = document.getElementById(`remote-video-${currentUserId}`);
          if (addedVideo) {
            console.log('🖥️ Видео элемент найден в DOM через 1 секунду:', {
              width: addedVideo.offsetWidth,
              height: addedVideo.offsetHeight,
              readyState: (addedVideo as HTMLVideoElement).readyState,
              videoWidth: (addedVideo as HTMLVideoElement).videoWidth,
              videoHeight: (addedVideo as HTMLVideoElement).videoHeight
            });
          }
        }, 1000);
      } else if (attempts < 50) { // Максимум 5 секунд (50 * 100ms)
        // Контейнер ещё не создан, ждем
        console.log(`🖥️ Ожидание контейнера screen-share-container-chat (попытка ${attempts + 1}/50)`);
        setTimeout(() => waitForContainer(attempts + 1), 100);
      } else {
        // Превышено время ожидания
        console.error('🖥️ Превышено время ожидания контейнера screen-share-container-chat');
        localVideo.remove();
        return;
      }
    };
    
    waitForContainer();

    // Уведомляем о начале демонстрации экрана для локального пользователя
    if (this.onScreenShareChanged) {
      this.onScreenShareChanged(currentUserId, true);
    }
  }
}

// Проверяем, есть ли уже экземпляр
if (typeof window !== 'undefined' && window.__voiceServiceInstance) {
  console.log('🎙️ Используем существующий экземпляр VoiceService');
  // Закрываем старое соединение если есть
  window.__voiceServiceInstance.disconnect();
} else {
}

const voiceServiceInstance = new VoiceService();

// Сохраняем экземпляр глобально
if (typeof window !== 'undefined') {
  window.__voiceServiceInstance = voiceServiceInstance;
  
  // Закрываем соединение при закрытии страницы
  window.addEventListener('beforeunload', () => {
    console.log('🎙️ Страница закрывается, отключаем голосовое соединение');
    voiceServiceInstance.disconnect();
  });
  
  // Также обрабатываем скрытие страницы
  window.addEventListener('pagehide', () => {
    console.log('🎙️ Страница скрывается, отключаем голосовое соединение');
    voiceServiceInstance.disconnect();
  });
}

// Глобальная функция для тестирования (доступна из консоли браузера)
if (typeof window !== 'undefined') {
  (window as any).testNoiseGate = () => {
  };

  (window as any).toggleNoiseGate = () => {
    advancedNoiseGate.disableTemporarily();
  };

  (window as any).testAudioSettings = async () => {
    console.log('🧪 ТЕСТИРОВАНИЕ ОБНОВЛЕНИЯ АУДИО НАСТРОЕК:');
    try {
      await voiceServiceInstance.updateAudioSettings({
        noiseSuppression: false
      });
      console.log('⏳ Ждем 3 секунды...');
      setTimeout(async () => {
        await voiceServiceInstance.updateAudioSettings({
          noiseSuppression: true
        });
        console.log('✅ Тест завершен');
      }, 3000);
    } catch (error) {
      console.error('❌ Ошибка теста:', error);
    }
  };

  console.log('💡 Для тестирования используйте:');
  console.log('   testNoiseGate() - показать настройки шумодава');
  console.log('   toggleNoiseGate() - временно отключить шумодав');
  console.log('   testAudioSettings() - протестировать обновление аудио настроек');
}


export default voiceServiceInstance;
