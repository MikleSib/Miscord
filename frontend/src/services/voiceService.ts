import { audioProcessingService } from './audioProcessingService';
import { useNoiseSuppressionStore } from '../store/noiseSuppressionStore';
import { useAudioDeviceStore } from '../store/audioDeviceStore';
import { useVADSettingsStore } from '../store/vadSettingsStore';
import { useAuthStore } from '../store/store';
import soundService from './soundService';
import { advancedNoiseGate } from './advancedNoiseGate';
import { mergeIceServers } from './iceServers';
import { shouldCreateOffer, canAcceptAnswer, shouldBufferIceCandidate } from './voicePeerUtils';
import {
  formatStreamQualityLabel,
  getDisplayMediaVideoConstraints,
  getElectronCaptureConstraints,
  getScreenShareEncoding,
  resolveQualitySettings,
} from '../lib/screenShareQuality';
import { useScreenShareSettingsStore } from '../store/screenShareSettingsStore';
import { StartScreenShareOptions } from '../lib/screenShareCapture';

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
  /** Игнорировать ended от треков, которые мы сами остановили при смене устройства. */
  private ignoreInputTrackEnded = false;
  private inputRecoveryInFlight = false;
  private deviceChangeHandler: (() => void) | null = null;
  private inputTrackEndedHandler: ((event: Event) => void) | null = null;
  private screenStream: MediaStream | null = null; // Поток демонстрации экрана
  /** Битрейт голосового канала из настроек (кбит/с). */
  private channelAudioBitrateKbps = 64;
  private peerConnections: Map<number, PeerConnection> = new Map();
  // Буфер кандидатов ICE, пришедших до установки remoteDescription
  private pendingIceCandidates: Map<number, RTCIceCandidateInit[]> = new Map();
  /** Answer пришёл раньше, чем мы успели отправить offer / создать peer. */
  private pendingAnswers: Map<number, RTCSessionDescriptionInit> = new Map();
  /** Один createPeerConnection на userId — иначе два PC и тишина до ICE restart. */
  private peerInitPromises: Map<number, Promise<RTCPeerConnection>> = new Map();
  /**
   * Поколение peer на userId. При force-recreate увеличивается —
   * старый initialize/handlers после await игнорируются (иначе тишина).
   */
  private peerGenerations: Map<number, number> = new Map();
  private iceServers: RTCIceServer[] = [];
  private iceRestartTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  /** Watchdog: если peer застрял не в checking/connected — полное пересоздание. */
  private connectWatchdogs: Map<number, ReturnType<typeof setTimeout>> = new Map();
  /** Сколько раз подряд пересоздавали peer (сброс при connected / inbound audio). */
  private recreateAttempts: Map<number, number> = new Map();
  /** Сколько раз watchdog продлил ожидание из‑за checking (макс. 1 = до ~24с). */
  private connectWatchdogExtends: Map<number, number> = new Map();
  /** connection_id собеседника с сервера — новый id = новый WebRTC, даже если UI «connected». */
  private remoteConnectionIds: Map<number, string> = new Map();
  /** Таймеры проверки: connectionState=connected, но входящих аудио-байт нет. */
  private mediaHealthTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  /** Сколько раз подряд media-health не увидел входящее аудио. */
  private mediaHealthMisses: Map<number, number> = new Map();
  /** Не сдаёмся навсегда: после N попыток — пауза и снова. */
  private static readonly MAX_RECREATE_BURST = 5;
  private static readonly RECREATE_COOLDOWN_MS = 8000;
  private static readonly CONNECT_WATCHDOG_MS = 10000;
  private static readonly MAX_WATCHDOG_EXTENDS = 1;
  private static readonly MEDIA_HEALTH_MS = 5000;
  /** Очередь WS: offer/answer/ice нельзя обрабатывать параллельно. */
  private messageQueue: Promise<void> = Promise.resolve();
  private voiceChannelId: number | null = null;
  private token: string | null = null;
  /** Инкремент на каждый connect — отсекает события от старой сессии. */
  private sessionId = 0;
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
  private lastScreenShareStartCancelled = false;
  private onScreenShareChanged: ((userId: number, isSharing: boolean) => void) | null = null;
  private isMuted: boolean = false;
  private isDeafened: boolean = false;
  private adaptiveQualityEnabled: boolean = true; // Включено ли адаптивное качество
  // Локальный справочник участников: userId -> { username, avatar_url }
  private participantDirectory: Map<number, { username: string; avatar_url?: string }> = new Map();
  /** Антиспам screen_share_viewer_joined (мс между отправками на одного стримера). */
  private lastViewerJoinedSent: Map<number, number> = new Map();
  /** Debounce ensureRemoteScreenShare. */
  private screenShareEnsureTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  
  // VAD настройки
  private vadThreshold: number = 50; // 0-100, где 0 = максимально чувствительный
  private inputMode: 'voice-activity' | 'push-to-talk' = 'voice-activity';
  private pttKey: string = 'Space';
  private pttDelayMs: number = 20;
  private isPTTActive: boolean = false;
  private pttKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private pttReleaseTimer: ReturnType<typeof setTimeout> | null = null;
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

    // В режиме рации микрофон «закрыт», пока не зажата клавиша — без смены кнопки Mute
    this.applyTransmitGate();
    if (mode === 'push-to-talk' && !this.isPTTActive) {
      this.setLocalSpeechDetected(false);
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

  public setPTTDelay(delayMs: number): void {
    this.pttDelayMs = Math.max(0, Math.min(2000, delayMs));
  }

  /** Синхронизация режима рации / VAD из настроек пользователя */
  public syncInputSettingsFromStore(): void {
    try {
      const {
        inputMode,
        pttKey,
        pttDelay,
        vadSensitivity,
      } = useVADSettingsStore.getState();
      this.updateVADThresholds(vadSensitivity);
      this.pttKey = pttKey || 'Space';
      this.setPTTDelay(pttDelay ?? 20);
      this.setInputMode(inputMode || 'voice-activity');
    } catch (error) {
      console.warn('🎙️ Не удалось синхронизировать настройки ввода:', error);
    }
  }

  /**
   * Реально ли микрофон сейчас должен передавать звук.
   * Режим рации: только пока зажата клавиша (и не Mute).
   */
  private canTransmitAudio(): boolean {
    if (this.isMuted) return false;
    if (this.inputMode === 'push-to-talk') return this.isPTTActive;
    return true;
  }

  private applyTransmitGate(): void {
    const enabled = this.canTransmitAudio();

    // Не трогаем isMuted / кнопку Mute — только фактическую передачу
    audioProcessingService.setMuted(!enabled || this.isMuted);

    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }

    this.peerConnections.forEach(({ pc }) => {
      pc.getSenders()
        .filter((sender) => sender.track?.kind === 'audio')
        .forEach((sender) => {
          if (sender.track) sender.track.enabled = enabled;
        });
    });
  }

  private clearPttReleaseTimer(): void {
    if (this.pttReleaseTimer != null) {
      clearTimeout(this.pttReleaseTimer);
      this.pttReleaseTimer = null;
    }
  }

  private activatePTT(): void {
    this.clearPttReleaseTimer();
    if (this.isPTTActive) return;
    this.isPTTActive = true;
    this.applyTransmitGate();
    if (!this.isMuted) {
      this.setLocalSpeechDetected(true);
    }
    console.log('🎙️ PTT активирован');
  }

  private deactivatePTT(): void {
    this.clearPttReleaseTimer();
    const release = () => {
      this.pttReleaseTimer = null;
      if (!this.isPTTActive) return;
      this.isPTTActive = false;
      this.applyTransmitGate();
      this.setLocalSpeechDetected(false);
      console.log('🎙️ PTT деактивирован');
    };

    if (this.pttDelayMs > 0) {
      this.pttReleaseTimer = setTimeout(release, this.pttDelayMs);
    } else {
      release();
    }
  }

  public setupPTTHandlers(): void {
    if (this.pttKeyHandler) {
      this.removePTTHandlers();
    }

    this.pttKeyHandler = (e: KeyboardEvent) => {
      if (e.code !== this.pttKey) return;
      // Не перехватываем набор текста в полях ввода
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.type === 'keydown') {
        if (e.repeat) return;
        e.preventDefault();
        this.activatePTT();
      } else if (e.type === 'keyup') {
        e.preventDefault();
        this.deactivatePTT();
      }
    };

    document.addEventListener('keydown', this.pttKeyHandler);
    document.addEventListener('keyup', this.pttKeyHandler);

    console.log('🎙️ PTT обработчики установлены для клавиши:', this.pttKey);
  }

  public removePTTHandlers(): void {
    this.clearPttReleaseTimer();
    if (this.pttKeyHandler) {
      document.removeEventListener('keydown', this.pttKeyHandler);
      document.removeEventListener('keyup', this.pttKeyHandler);
      this.pttKeyHandler = null;
    }

    if (this.isPTTActive) {
      this.isPTTActive = false;
      this.applyTransmitGate();
      this.setLocalSpeechDetected(false);
    }

    console.log('🎙️ PTT обработчики удалены');
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
    // Уже в этом канале с живым сокетом — не пересоздаём зря
    if (this.voiceChannelId === voiceChannelId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Discord: сначала полностью выходим из прошлого канала
    await this.disconnectAsync();

    const sessionId = ++this.sessionId;
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
      const inputDeviceId = useAudioDeviceStore.getState().inputDeviceId;
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(inputDeviceId && inputDeviceId !== 'default'
            ? { deviceId: { exact: inputDeviceId } }
            : {}),
          echoCancellation: true,
          noiseSuppression: useBrowserNoiseSuppression,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
        video: false,
      });
      this.unbindInputTrackWatchdogs(this.rawInputStream);
      this.rawInputStream = rawStream;
      this.bindInputTrackWatchdogs(rawStream);
      this.startDeviceWatch();

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

      const processedStream = await audioProcessingService.initialize(rawStream);

      const processedTrack = processedStream.getAudioTracks()[0];
      const useProcessedTrack =
        Boolean(processedTrack) && processedTrack.readyState === 'live';

      // Miscord AI обрабатывает звук в Web Audio graph — в эфир идёт processedStream.
      this.localStream = useProcessedTrack ? processedStream : rawStream;
      if (!useProcessedTrack) {
        console.warn('[VoiceService] Обработанный поток недоступен, fallback на сырой микрофон');
      }

      audioProcessingService.setInputVolume(useAudioDeviceStore.getState().inputVolume ?? 100);
      this.syncInputSettingsFromStore();
      this.applyTransmitGate();

      await audioProcessingService.refreshSpeakingDetection().catch(() => undefined);
      audioProcessingService.analyzeVolume(processedStream);
    } catch (error) {
      console.error('🎙️ Ошибка доступа к микрофону:', error);
      this.rawInputStream?.getTracks().forEach((track) => track.stop());
      this.rawInputStream = null;
      if (this.sessionId === sessionId) {
        this.voiceChannelId = null;
        this.token = null;
      }
      throw new Error('Не удалось получить доступ к микрофону');
    }

    if (this.sessionId !== sessionId) {
      this.rawInputStream?.getTracks().forEach((track) => track.stop());
      this.rawInputStream = null;
      this.localStream?.getTracks().forEach((track) => track.stop());
      this.localStream = null;
      await audioProcessingService.destroy();
      return;
    }

    // Подключаемся к WebSocket
    const wsUrl = `${WS_URL}/ws/voice/${voiceChannelId}?token=${encodeURIComponent(token)}`;
    console.log('[VoiceService] Подключаемся к голосовому WebSocket:', wsUrl.replace(/token=.+/, 'token=***'));
    const socket = new WebSocket(wsUrl);
    this.ws = socket;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const connectionTimeout = globalThis.setTimeout(() => {
        if (settled || this.sessionId !== sessionId || this.ws !== socket) return;
        settled = true;
        const callback = this.onConnectionStateChanged;
        void this.disconnectAsync();
        callback?.('error', 'Сервер голосового канала не ответил вовремя');
        reject(new Error('Сервер голосового канала не ответил вовремя'));
      }, 15000);

      const clearConnectionTimeout = () => globalThis.clearTimeout(connectionTimeout);
      const isCurrentSession = () => this.sessionId === sessionId && this.ws === socket;

      socket.onopen = () => {
        if (!isCurrentSession()) return;
        const joinMessage = {
          type: 'join',
          channel_id: voiceChannelId,
          is_muted: isMuted,
          is_deafened: isDeafened
        };
        socket.send(JSON.stringify(joinMessage));
        this.initVoiceActivityDetection();
        settled = true;
        clearConnectionTimeout();
        this.onConnectionStateChanged?.('connected');
        resolve();
      };

      socket.onerror = (event) => {
        console.error('🎙️ Ошибка Voice WebSocket:', event);
        if (!settled && isCurrentSession()) {
          settled = true;
          clearConnectionTimeout();
          const callback = this.onConnectionStateChanged;
          void this.disconnectAsync();
          callback?.('error', 'Не удалось подключиться к голосовому каналу');
          reject(new Error('Не удалось подключиться к голосовому каналу'));
        }
      };

      socket.onmessage = (event) => {
        if (!isCurrentSession()) return;
        // Строго по очереди — иначе createPeerConnection гоняется с offer/answer
        this.messageQueue = this.messageQueue
          .then(async () => {
            if (!isCurrentSession()) return;
            try {
              const data = JSON.parse(event.data);
              await this.handleMessage(data);
            } catch (error) {
              console.error('🎙️ Некорректное сообщение голосового WebSocket:', error);
            }
          })
          .catch((error) => {
            console.error('🎙️ Ошибка очереди голосовых сообщений:', error);
          });
      };

      socket.onclose = (event) => {
        clearConnectionTimeout();

        if (!settled) {
          settled = true;
          reject(new Error(event.reason || 'Голосовое соединение было закрыто'));
        }

        // Реагируем только если это всё ещё активная сессия
        if (isCurrentSession()) {
          const callback = this.onConnectionStateChanged;
          const reason =
            event.reason ||
            (event.code === 1000 ? undefined : 'Соединение с голосовым каналом потеряно');
          this.cleanup();
          callback?.('disconnected', reason);
        }
      };
    });
  }

  /**
   * Раньше тут переставляли Opus RED в SDP — это ломало переговоры
   * на части устройств (телефон/Chrome). Личные звонки без RED работают стабильно.
   */
  private enableOpusRed(sdp: string): string {
    return sdp;
  }
  private async handleMessage(data: any) {
    
    switch (data.type) {
      case 'participants':
        // Серверные ICE + запасной TURN (личные звонки уже ходят через него).
        this.iceServers = mergeIceServers(
          Array.isArray(data.ice_servers) ? data.ice_servers : []
        );
        console.log('[VoiceService] ICE servers:', this.iceServers.map((s) => s.urls));

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
            if (typeof participant.connection_id === 'string' && participant.connection_id) {
              this.remoteConnectionIds.set(participant.user_id, participant.connection_id);
            }
            await this.createPeerConnection(
              participant.user_id,
              shouldCreateOffer(currentUserId, participant.user_id),
              false
            );
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
        
        // user_joined = новая голосовая сессия. Старый "connected" часто мёртвый
        // (reconnect без leave) — тогда мы молчали минутами. Пересобираем всегда,
        // кроме точного дубля того же connection_id.
        if (data.user_id !== currentUserId2) {
          const newConnId =
            typeof data.connection_id === 'string' && data.connection_id
              ? data.connection_id
              : null;
          const prevConnId = this.remoteConnectionIds.get(data.user_id);
          const existing = this.peerConnections.get(data.user_id)?.pc;
          const sameSession =
            newConnId !== null &&
            prevConnId === newConnId &&
            existing &&
            (existing.connectionState === 'connected' ||
              existing.iceConnectionState === 'connected' ||
              existing.iceConnectionState === 'completed');

          if (sameSession) {
            console.log(
              '🔊 [VoiceService] Дубль user_joined той же сессии',
              data.user_id,
              newConnId
            );
            break;
          }

          if (newConnId) {
            this.remoteConnectionIds.set(data.user_id, newConnId);
          } else {
            this.remoteConnectionIds.delete(data.user_id);
          }

          const createOffer = shouldCreateOffer(currentUserId2, data.user_id);
          console.log(
            '🔊 [VoiceService] Пересоздаём peer для',
            data.user_id,
            'shouldCreateOffer:',
            createOffer,
            'prevState:',
            existing?.connectionState,
            'connId:',
            newConnId
          );
          this.recreateAttempts.delete(data.user_id);
          await this.createPeerConnection(data.user_id, createOffer, true);
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
        this.recreateAttempts.delete(data.user_id);
        this.remoteConnectionIds.delete(data.user_id);
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

      case 'request_offer':
        // Нас попросили прислать offer (мы меньший user_id). Без этого
        // сторона с большим id после recreate ждёт вечность.
        await this.handleRequestOffer(data.from_id);
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

        // Эхо своего стрима с сервера — UI уже обновлён локально
        if (data.user_id === this.getCurrentUserId()) {
          break;
        }

        const screenShareStartEvent = new CustomEvent('screen_share_start', {
          detail: {
            user_id: data.user_id,
            username: data.username,
            avatar_url: data.avatar_url,
          },
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(screenShareStartEvent);
        }
        console.log('🖥️ Отправлено событие screen_share_start для UI');
        
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, true);
        }

        void this.ensureRemoteScreenShare(data.user_id);
        break;

      case 'screen_share_stopped':
        console.log('🖥️ Пользователь остановил демонстрацию экрана:', data.user_id);

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
        const videoContainer = document.getElementById('screen-share-video-pool');
        if (videoContainer && videoContainer.children.length === 0) {
          videoContainer.style.display = 'none';
          console.log('🖥️ Контейнер скрыт, так как нет активных демонстраций экрана');
        }
        
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, false);
        }
        break;

      case 'screen_share_viewer_joined':
        console.log('🖥️ Зритель присоединился к стриму:', data.viewer_id, data.viewer_username);
        soundService.playStreamJoinSound();
        if (this.isScreenSharing) {
          const viewerId = Number(data.viewer_id);
          if (Number.isFinite(viewerId)) {
            void this.refreshScreenShareOfferForViewer(viewerId);
          }
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

  private async createPeerConnection(
    userId: number,
    createOffer: boolean,
    forceRecreate: boolean = false
  ) {
    const existingPeer = this.peerConnections.get(userId)?.pc;
    const existingAlive =
      existingPeer &&
      existingPeer.connectionState !== 'closed' &&
      existingPeer.connectionState !== 'failed';

    // Переиспользуем только полностью живой peer. connecting/disconnected — мусор после reconnect.
    if (
      !forceRecreate &&
      existingAlive &&
      existingPeer.connectionState === 'connected'
    ) {
      return existingPeer;
    }

    if (forceRecreate || (existingAlive && existingPeer.connectionState !== 'connected')) {
      console.log(
        `[VoiceService] Пересоздание peer ${userId} (force=${forceRecreate}, state=${existingPeer?.connectionState})`
      );
      this.removePeerConnection(userId);
    } else if (existingPeer && !existingAlive) {
      this.removePeerConnection(userId);
    }

    const inflight = this.peerInitPromises.get(userId);
    if (inflight && !forceRecreate) {
      const pc = await inflight;
      // После await peer мог быть пересоздан — отдаём актуальный
      const current = this.peerConnections.get(userId)?.pc;
      if (current && current !== pc) {
        return current;
      }
      if (
        createOffer &&
        pc.signalingState === 'stable' &&
        !pc.currentRemoteDescription &&
        !pc.currentLocalDescription &&
        this.isPeerCurrent(userId, pc)
      ) {
        await this.sendOfferToPeer(userId, pc);
      }
      return this.peerConnections.get(userId)?.pc ?? pc;
    }

    const generation = (this.peerGenerations.get(userId) || 0) + 1;
    this.peerGenerations.set(userId, generation);

    const initPromise = this.initializePeerConnection(userId, createOffer, generation);
    this.peerInitPromises.set(userId, initPromise);
    try {
      return await initPromise;
    } finally {
      // Удаляем только свою промису — чужую (более новое поколение) не трогаем
      if (this.peerInitPromises.get(userId) === initPromise) {
        this.peerInitPromises.delete(userId);
      }
    }
  }

  private isPeerCurrent(userId: number, pc: RTCPeerConnection, generation?: number): boolean {
    if (generation !== undefined && this.peerGenerations.get(userId) !== generation) {
      return false;
    }
    return this.peerConnections.get(userId)?.pc === pc;
  }

  private async initializePeerConnection(
    userId: number,
    createOffer: boolean,
    generation: number
  ): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers.length > 0 ? this.iceServers : mergeIceServers([]),
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
    });

    // Сразу в map — до любых await, иначе параллельный handleOffer создаст второй PC
    this.peerConnections.set(userId, { pc, userId });
    
    // Добавляем обработчики событий для отладки и адаптивного качества
    pc.oniceconnectionstatechange = () => {
      if (!this.isPeerCurrent(userId, pc, generation)) return;
      const iceState = pc.iceConnectionState;
      console.log(`[VoiceService] ICE user ${userId}: ${iceState}`);

      if (iceState === 'connected' || iceState === 'completed') {
        this.clearIceRestartTimer(userId);
        this.clearConnectWatchdog(userId);
        this.recreateAttempts.delete(userId);
        this.connectWatchdogExtends.delete(userId);
        this.armMediaHealthCheck(userId, pc, generation);
      } else if (iceState === 'failed') {
        this.clearIceRestartTimer(userId);
        // Полное пересоздание надёжнее iceRestart на мобильных сетях
        this.enqueueVoiceTask(() => this.recreatePeerConnection(userId));
      } else if (iceState === 'disconnected' && !this.iceRestartTimers.has(userId)) {
        // Короткий disconnected бывает при смене сети — ждём, потом пересоздаём
        const timer = globalThis.setTimeout(() => {
          this.iceRestartTimers.delete(userId);
          if (!this.isPeerCurrent(userId, pc, generation)) return;
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            this.enqueueVoiceTask(() => this.recreatePeerConnection(userId));
          }
        }, 3000);
        this.iceRestartTimers.set(userId, timer);
      }
      // НЕ трогаем 'checking' — это нормальная фаза ICE, iceRestart тут убивал связь

      this.adjustVideoQuality(pc, userId, false);
    };
    
    pc.onicegatheringstatechange = () => {
      if (!this.isPeerCurrent(userId, pc, generation)) return;
      console.log(`[VoiceService] ICE gathering ${userId}: ${pc.iceGatheringState}`);
    };
    
    pc.onconnectionstatechange = () => {
      if (!this.isPeerCurrent(userId, pc, generation)) return;
      console.log(`[VoiceService] Peer user ${userId}: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        this.clearConnectWatchdog(userId);
        this.recreateAttempts.delete(userId);
        this.connectWatchdogExtends.delete(userId);
        this.armMediaHealthCheck(userId, pc, generation);
      } else if (pc.connectionState === 'failed') {
        this.enqueueVoiceTask(() => this.recreatePeerConnection(userId));
      }
      this.adjustVideoQuality(pc, userId, false);
    };

    this.armConnectWatchdog(userId);
    
    pc.onsignalingstatechange = () => {
      if (!this.isPeerCurrent(userId, pc, generation)) return;
      // Answer мог прийти пока мы ещё не были в have-local-offer
      if (canAcceptAnswer(pc.signalingState)) {
        const pending = this.pendingAnswers.get(userId);
        if (pending) {
          this.pendingAnswers.delete(userId);
          void this.handleAnswer(userId, pending);
        }
      }
    };

    // Добавляем локальный поток
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
      await this.applyAudioBitrateToPeer(pc);
      
      // Настраиваем адаптивное качество для видео треков
      await this.adjustVideoQuality(pc, userId, false);
      if (!this.isPeerCurrent(userId, pc, generation)) {
        try { pc.close(); } catch { /* ignore */ }
        return pc;
      }
    }

    // Если мы УЖЕ демонстрируем экран, добавим screenShare треки и инициируем переговоры
    if (this.isScreenSharing && this.screenStream) {
      try {
        await this.updatePeerConnectionForScreenShare(pc, userId);
      } catch (e) {
        console.warn(`🖥️ Не удалось сразу добавить screen share для нового соединения с пользователем ${userId}:`, e);
      }
      if (!this.isPeerCurrent(userId, pc, generation)) {
        try { pc.close(); } catch { /* ignore */ }
        return pc;
      }
    }

    // Обработка входящего потока
    pc.ontrack = (event) => {
      if (!this.isPeerCurrent(userId, pc, generation)) return;
      const stream =
        event.streams?.[0] ||
        (event.track ? new MediaStream([event.track]) : null);

      if (!stream) {
        console.warn(`[VoiceService] ontrack без stream/track от ${userId}`);
        return;
      }

      {
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();

        // Обрабатываем аудио треки
        if (audioTracks.length > 0 || event.track?.kind === 'audio') {
          const tracksForPlayback =
            audioTracks.length > 0
              ? audioTracks
              : event.track?.kind === 'audio'
                ? [event.track]
                : [];

          console.log(
            `[VoiceService] Входящее аудио от ${userId}: tracks=${tracksForPlayback.length}, muted=${this.isDeafened}`
          );

          let remoteAudio = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement | null;
          if (!remoteAudio) {
            remoteAudio = new Audio();
            remoteAudio.id = `remote-audio-${userId}`;
            remoteAudio.autoplay = true;
            remoteAudio.controls = false;
            remoteAudio.setAttribute('playsinline', 'true');
            remoteAudio.style.display = 'none';
            document.body.appendChild(remoteAudio);
          }
          remoteAudio.srcObject = new MediaStream(tracksForPlayback);
          remoteAudio.muted = this.isDeafened;
          // Общая громкость вывода (по умолчанию 100%) × персональная громкость участника
          const outputVolume = (useAudioDeviceStore.getState().outputVolume ?? 100) / 100;
          const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
          const participantVolume = savedVolume
            ? Math.min(Math.max(Number.parseInt(savedVolume, 10) || 100, 0), 100) / 100
            : 1;
          remoteAudio.volume = Math.min(1, Math.max(0, outputVolume * participantVolume));

          const outputDeviceId = useAudioDeviceStore.getState().outputDeviceId;
          if (
            outputDeviceId &&
            outputDeviceId !== 'default' &&
            typeof (remoteAudio as any).setSinkId === 'function'
          ) {
            (remoteAudio as any).setSinkId(outputDeviceId).catch(() => undefined);
          }
          
          // Пытаемся воспроизвести аудио
          const playPromise = remoteAudio.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log(`[VoiceService] Воспроизведение аудио от ${userId} OK`);
            }).catch(error => {
              console.warn(`[VoiceService] autoplay blocked for ${userId}:`, error);
              
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
              const videoContainer = document.getElementById('screen-share-video-pool');

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
                console.warn(`🖥️ Пул видео не найден (user ${userId}), fallback на body`);
                this.attachRemoteVideoElement(remoteVideo, userId);
              }
            };

            // Также используем MutationObserver для отслеживания появления контейнера
            const observer = new MutationObserver((mutations) => {
              mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                  if (node instanceof HTMLElement && node.id === 'screen-share-video-pool') {
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
            const container = document.getElementById('screen-share-video-pool');
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
              const container = document.getElementById('screen-share-video-pool');
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
      if (!this.isPeerCurrent(userId, pc, generation)) return;
      if (event.candidate) {
        this.sendMessage({
          type: 'ice_candidate',
          target_id: userId,
          candidate: event.candidate,
        });
      }
    };

    if (createOffer) {
      if (this.isPeerCurrent(userId, pc, generation)) {
        await this.sendOfferToPeer(userId, pc);
      }
    } else if (this.isPeerCurrent(userId, pc, generation)) {
      // Мы ждём offer — явно просим меньший user_id, иначе тишина на минуты
      this.requestOfferFromPeer(userId);
    }

    if (!this.isPeerCurrent(userId, pc, generation)) {
      try { pc.close(); } catch { /* ignore */ }
      return pc;
    }

    // Answer мог прийти раньше, чем мы создали peer / отправили offer
    const pendingAnswer = this.pendingAnswers.get(userId);
    if (pendingAnswer) {
      this.pendingAnswers.delete(userId);
      await this.handleAnswer(userId, pendingAnswer);
    }

    return pc;
  }

  /** Попросить собеседника (меньший user_id) прислать offer. */
  private requestOfferFromPeer(userId: number): void {
    this.sendMessage({
      type: 'request_offer',
      target_id: userId,
    });
    console.log(`[VoiceService] request_offer → ${userId}`);
  }

  private async handleRequestOffer(fromUserId: number): Promise<void> {
    const currentUserId = this.getCurrentUserId();
    if (!shouldCreateOffer(currentUserId, fromUserId)) {
      // Нас попросили, но offer должен делать другой — игнор
      return;
    }

    let peer = this.peerConnections.get(fromUserId);
    if (!peer) {
      await this.createPeerConnection(fromUserId, true, true);
      return;
    }

    const pc = peer.pc;
    // Если уже идёт нормальный обмен — не ломаем
    if (
      pc.signalingState === 'have-local-offer' ||
      pc.signalingState === 'have-remote-offer'
    ) {
      return;
    }

    // Connected без входящего звука или просто stable без remote — шлём (пере)offer
    try {
      if (pc.signalingState === 'stable' && pc.connectionState === 'connected') {
        const hasAudio = await this.hasInboundAudio(pc);
        if (hasAudio) {
          console.log(`[VoiceService] request_offer от ${fromUserId}: звук уже есть`);
          return;
        }
        await this.sendOfferToPeer(fromUserId, pc, true);
        return;
      }
      if (pc.signalingState === 'stable') {
        await this.sendOfferToPeer(fromUserId, pc, Boolean(pc.currentRemoteDescription));
        return;
      }
    } catch (error) {
      console.warn(`[VoiceService] handleRequestOffer failed for ${fromUserId}:`, error);
    }

    await this.createPeerConnection(fromUserId, true, true);
  }

  private async hasInboundAudio(pc: RTCPeerConnection): Promise<boolean> {
    try {
      const stats = await pc.getStats();
      let bytes = 0;
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          bytes += report.bytesReceived ?? 0;
        }
      });
      return bytes > 0;
    } catch {
      return false;
    }
  }

  /**
   * connectionState=connected ≠ «я слышу». Через 5с проверяем inbound байты;
   * если 0 — просим offer / пересоздаём.
   */
  private armMediaHealthCheck(
    userId: number,
    pc: RTCPeerConnection,
    generation: number
  ): void {
    this.clearMediaHealthTimer(userId);
    const timer = globalThis.setTimeout(() => {
      this.mediaHealthTimers.delete(userId);
      void this.runMediaHealthCheck(userId, pc, generation);
    }, VoiceService.MEDIA_HEALTH_MS);
    this.mediaHealthTimers.set(userId, timer);
  }

  private clearMediaHealthTimer(userId: number): void {
    const timer = this.mediaHealthTimers.get(userId);
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
      this.mediaHealthTimers.delete(userId);
    }
  }

  private async runMediaHealthCheck(
    userId: number,
    pc: RTCPeerConnection,
    generation: number
  ): Promise<void> {
    if (!this.isPeerCurrent(userId, pc, generation)) return;
    if (pc.connectionState !== 'connected' && pc.iceConnectionState !== 'connected') {
      return;
    }

    const audioEl = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement | null;
    const hasAudio = await this.hasInboundAudio(pc);

    if (hasAudio) {
      this.mediaHealthMisses.delete(userId);
      this.recreateAttempts.delete(userId);
      if (audioEl?.paused) {
        try {
          audioEl.muted = this.isDeafened;
          await audioEl.play();
          console.log(`[VoiceService] media health: play() дожат для ${userId}`);
        } catch {
          /* autoplay — пользовательский жест */
        }
      }
      return;
    }

    const misses = (this.mediaHealthMisses.get(userId) || 0) + 1;
    this.mediaHealthMisses.set(userId, misses);
    console.warn(
      `[VoiceService] media health: peer ${userId} connected без inbound audio (miss=${misses})`
    );

    const currentUserId = this.getCurrentUserId();
    if (shouldCreateOffer(currentUserId, userId) || misses >= 2) {
      this.mediaHealthMisses.delete(userId);
      this.enqueueVoiceTask(() => this.recreatePeerConnection(userId));
    } else {
      this.requestOfferFromPeer(userId);
      this.armMediaHealthCheck(userId, pc, generation);
    }
  }

  /** Все recreate/offer-чинки — через ту же очередь, что и WS, без гонок. */
  private enqueueVoiceTask(task: () => Promise<void>): void {
    this.messageQueue = this.messageQueue
      .then(async () => {
        try {
          await task();
        } catch (error) {
          console.error('[VoiceService] Ошибка фоновой voice-задачи:', error);
        }
      })
      .catch((error) => {
        console.error('[VoiceService] Ошибка очереди voice-задач:', error);
      });
  }

  private async sendOfferToPeer(
    userId: number,
    pc: RTCPeerConnection,
    iceRestart: boolean = false
  ): Promise<void> {
    if (!iceRestart) {
      if (pc.signalingState !== 'stable') return;
      if (pc.currentLocalDescription || pc.pendingLocalDescription) return;
    } else if (pc.signalingState !== 'stable') {
      return;
    }

    const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
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

  private clearIceRestartTimer(userId: number): void {
    const timer = this.iceRestartTimers.get(userId);
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
      this.iceRestartTimers.delete(userId);
    }
  }

  private clearConnectWatchdog(userId: number): void {
    const timer = this.connectWatchdogs.get(userId);
    if (timer !== undefined) {
      globalThis.clearTimeout(timer);
      this.connectWatchdogs.delete(userId);
    }
  }

  /**
   * Watchdog 12с. НЕ рвём ICE в checking — через TURN это нормально 5–10с.
   * Пересоздаём только если реально застряли (new/connecting без прогресса / failed).
   */
  private armConnectWatchdog(userId: number): void {
    this.clearConnectWatchdog(userId);
    const timer = globalThis.setTimeout(() => {
      this.connectWatchdogs.delete(userId);
      const peer = this.peerConnections.get(userId);
      if (!peer) return;

      const pcState = peer.pc.connectionState;
      const iceState = peer.pc.iceConnectionState;

      if (
        pcState === 'connected' ||
        iceState === 'connected' ||
        iceState === 'completed'
      ) {
        return;
      }

      // ICE ещё работает — один раз продлеваем (TURN часто 5–15с), потом пересоздаём
      if (iceState === 'checking' || iceState === 'disconnected') {
        const extendCount = this.connectWatchdogExtends.get(userId) || 0;
        if (extendCount < VoiceService.MAX_WATCHDOG_EXTENDS) {
          this.connectWatchdogExtends.set(userId, extendCount + 1);
          console.log(
            `[VoiceService] Watchdog: peer ${userId} ещё ${iceState} — продление ${extendCount + 1}`
          );
          this.armConnectWatchdog(userId);
          return;
        }
      }

      console.warn(
        `[VoiceService] Watchdog: peer ${userId} застрял ` +
          `(pc=${pcState}, ice=${iceState}) — пересоздаём`
      );
      this.enqueueVoiceTask(() => this.recreatePeerConnection(userId));
    }, VoiceService.CONNECT_WATCHDOG_MS);
    this.connectWatchdogs.set(userId, timer);
  }

  private async recreatePeerConnection(userId: number): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.peerConnections.has(userId) && !this.peerInitPromises.has(userId)) return;

    const attempts = (this.recreateAttempts.get(userId) || 0) + 1;
    this.recreateAttempts.set(userId, attempts);

    // После пачки неудач — пауза, но НЕ сдаёмся навсегда (это давало тишину ~2 мин)
    if (attempts > VoiceService.MAX_RECREATE_BURST) {
      console.warn(
        `[VoiceService] recreate ${userId}: пауза ${VoiceService.RECREATE_COOLDOWN_MS}ms после ${attempts - 1} попыток`
      );
      this.recreateAttempts.set(userId, 0);
      globalThis.setTimeout(() => {
        if (!this.peerConnections.has(userId) && !this.peerInitPromises.has(userId)) return;
        this.enqueueVoiceTask(() => this.recreatePeerConnection(userId));
      }, VoiceService.RECREATE_COOLDOWN_MS);
      return;
    }

    const currentUserId = this.getCurrentUserId();
    const createOffer = shouldCreateOffer(currentUserId, userId);
    console.log(
      `[VoiceService] recreatePeerConnection ${userId}, createOffer=${createOffer}, attempt=${attempts}`
    );
    await this.createPeerConnection(userId, createOffer, true);

    // Больший id сам offer не шлёт — сразу просим
    if (!createOffer) {
      this.requestOfferFromPeer(userId);
    }
  }

  private async restartPeerIce(userId: number): Promise<void> {
    // Мягкий fallback; основной путь — recreatePeerConnection
    const currentUserId = this.getCurrentUserId();
    const peer = this.peerConnections.get(userId);
    if (!peer || currentUserId === null || currentUserId > userId) return;
    if (peer.pc.signalingState !== 'stable') return;

    try {
      await this.sendOfferToPeer(userId, peer.pc, true);
      console.log(`[VoiceService] Отправлен ICE restart offer пользователю ${userId}`);
    } catch (error) {
      console.warn(`[VoiceService] Не удалось перезапустить ICE для пользователя ${userId}:`, error);
      this.enqueueVoiceTask(() => this.recreatePeerConnection(userId));
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

      await this.flushPendingIceCandidates(userId, peerConnection.pc);

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

    let peerConnection = this.peerConnections.get(userId);
    if (!peerConnection) {
      const inflight = this.peerInitPromises.get(userId);
      if (inflight) {
        await inflight;
        peerConnection = this.peerConnections.get(userId);
      }
    }

    if (!peerConnection) {
      // Answer раньше offer/peer — сохраним и применим после createOffer
      console.warn(`🔊 Answer от ${userId} буферизуем — peer ещё не готов`);
      this.pendingAnswers.set(userId, answer);
      return;
    }

    try {
      if (!canAcceptAnswer(peerConnection.pc.signalingState)) {
        console.warn(
          `🔊 Answer от ${userId} буферизуем — signalingState=${peerConnection.pc.signalingState}`
        );
        this.pendingAnswers.set(userId, answer);
        return;
      }
      await peerConnection.pc.setRemoteDescription(answer);
      this.pendingAnswers.delete(userId);
      await this.flushPendingIceCandidates(userId, peerConnection.pc);
    } catch (error) {
      console.error(`🔊 Ошибка при обработке answer от пользователя ${userId}:`, error);
    }
  }

  private async flushPendingIceCandidates(userId: number, pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingIceCandidates.get(userId);
    if (!queued || queued.length === 0) return;
    for (const cand of queued) {
      try {
        await pc.addIceCandidate(cand);
      } catch (e) {
        console.warn(`🔊 Не удалось применить отложенный ICE candidate для ${userId}:`, e);
      }
    }
    this.pendingIceCandidates.delete(userId);
  }

  private async handleIceCandidate(userId: number, candidate: RTCIceCandidateInit) {
    const peerConnection = this.peerConnections.get(userId);
    const hasRemoteDescription = Boolean(peerConnection?.pc.remoteDescription);

    if (shouldBufferIceCandidate(Boolean(peerConnection), hasRemoteDescription)) {
      const list = this.pendingIceCandidates.get(userId) || [];
      list.push(candidate);
      this.pendingIceCandidates.set(userId, list);
      return;
    }

    try {
      await peerConnection!.pc.addIceCandidate(candidate);
    } catch (error) {
      console.error(`🔊 Ошибка при добавлении ICE candidate для пользователя ${userId}:`, error);
    }
  }

  private removePeerConnection(userId: number) {
    console.log(`🔊 Удаляем peer connection для пользователя ${userId}`);
    
    this.clearIceRestartTimer(userId);
    this.clearConnectWatchdog(userId);
    this.clearMediaHealthTimer(userId);
    this.mediaHealthMisses.delete(userId);
    // Инвалидируем поколение — любые await старого initialize отвалятся
    this.peerGenerations.set(userId, (this.peerGenerations.get(userId) || 0) + 1);
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      try {
        peerConnection.pc.onicecandidate = null;
        peerConnection.pc.ontrack = null;
        peerConnection.pc.oniceconnectionstatechange = null;
        peerConnection.pc.onconnectionstatechange = null;
      } catch { /* ignore */ }
      peerConnection.pc.close();
      this.peerConnections.delete(userId);
    }
    this.pendingIceCandidates.delete(userId);
    this.pendingAnswers.delete(userId);
    this.peerInitPromises.delete(userId);
    this.connectWatchdogExtends.delete(userId);
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

  /** Сменить динамик/наушники для всех входящих голосов. */
  async setOutputDevice(deviceId: string): Promise<void> {
    const nextId = deviceId || 'default';
    useAudioDeviceStore.getState().setOutputDeviceId(nextId);

    if (typeof document === 'undefined') return;

    const sinkId = nextId === 'default' ? '' : nextId;
    const audioElements = document.querySelectorAll<HTMLAudioElement>('[id^="remote-audio-"]');
    await Promise.all(
      Array.from(audioElements).map(async (audio) => {
        if (typeof (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId !== 'function') {
          return;
        }
        try {
          await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(sinkId);
        } catch (error) {
          console.warn('Не удалось применить устройство вывода:', error);
        }
      })
    );
  }

  /**
   * Сменить микрофон во время активного голосового канала.
   * Пересоздаёт raw stream + пайплайн обработки и подменяет трек в peer connections.
   */
  async switchInputDevice(deviceId: string): Promise<void> {
    const nextId = deviceId || 'default';
    useAudioDeviceStore.getState().setInputDeviceId(nextId);

    if (!this.voiceChannelId) {
      return;
    }

    const noiseSuppressionSettings = useNoiseSuppressionStore.getState();
    const useBrowserNoiseSuppression =
      noiseSuppressionSettings.enabled && noiseSuppressionSettings.engine === 'browser';

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: useBrowserNoiseSuppression,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
    };

    let newRaw: MediaStream;
    try {
      newRaw = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...audioConstraints,
          ...(nextId !== 'default' ? { deviceId: { ideal: nextId } } : {}),
        },
        video: false,
      });
    } catch (error) {
      console.warn('🎙️ Не удалось открыть выбранный микрофон, пробуем любой:', error);
      newRaw = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
    }

    const previousRaw = this.rawInputStream;
    this.unbindInputTrackWatchdogs(previousRaw);
    this.rawInputStream = newRaw;
    this.bindInputTrackWatchdogs(newRaw);

    const processedStream = await audioProcessingService.initialize(newRaw);
    const processedTrack = processedStream.getAudioTracks()[0];
    const useProcessedTrack =
      Boolean(processedTrack) && processedTrack.readyState === 'live';
    this.localStream = useProcessedTrack ? processedStream : newRaw;

    audioProcessingService.setInputVolume(useAudioDeviceStore.getState().inputVolume ?? 100);
    this.syncInputSettingsFromStore();
    this.applyTransmitGate();

    const trackToSend = this.localStream.getAudioTracks()[0] ?? null;
    await Promise.all(
      Array.from(this.peerConnections.values()).map(async ({ pc }) => {
        const audioSender =
          pc.getSenders().find((sender) => sender.track?.kind === 'audio') ??
          pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio')?.sender;

        if (audioSender) {
          try {
            await audioSender.replaceTrack(trackToSend);
          } catch (error) {
            console.warn('replaceTrack при смене микрофона не удался:', error);
          }
          return;
        }

        if (trackToSend && this.localStream) {
          pc.addTrack(trackToSend, this.localStream);
        }
      })
    );

    this.ignoreInputTrackEnded = true;
    try {
      previousRaw?.getTracks().forEach((track) => track.stop());
    } finally {
      // небольшой сдвиг, чтобы ended от старого трека не запустил recover
      window.setTimeout(() => {
        this.ignoreInputTrackEnded = false;
      }, 300);
    }

    await audioProcessingService.refreshSpeakingDetection().catch(() => undefined);
    if (this.localStream) {
      audioProcessingService.analyzeVolume(this.localStream);
    }

    const actualId = newRaw.getAudioTracks()[0]?.getSettings()?.deviceId;
    if (actualId) {
      useAudioDeviceStore.getState().setInputDeviceId(actualId);
    }

    console.log('🎙️ Микрофон переключён:', actualId || nextId);
  }

  private unbindInputTrackWatchdogs(stream: MediaStream | null): void {
    if (!stream || !this.inputTrackEndedHandler) return;
    const handler = this.inputTrackEndedHandler;
    stream.getAudioTracks().forEach((track) => {
      track.removeEventListener('ended', handler);
    });
  }

  /** Подписка на обрыв USB-микрофона и смену устройств. */
  private bindInputTrackWatchdogs(stream: MediaStream): void {
    this.inputTrackEndedHandler = () => {
      if (this.ignoreInputTrackEnded) return;
      console.warn('🎙️ Трек микрофона завершился — пробуем другое устройство');
      void this.recoverInputDevice();
    };

    const handler = this.inputTrackEndedHandler;
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', handler);
    });
  }

  private startDeviceWatch(): void {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    if (this.deviceChangeHandler) return;

    this.deviceChangeHandler = () => {
      void this.handleDeviceChange();
    };
    navigator.mediaDevices.addEventListener('devicechange', this.deviceChangeHandler);
  }

  private stopDeviceWatch(): void {
    if (!this.deviceChangeHandler || typeof navigator === 'undefined' || !navigator.mediaDevices) {
      this.deviceChangeHandler = null;
      return;
    }
    navigator.mediaDevices.removeEventListener('devicechange', this.deviceChangeHandler);
    this.deviceChangeHandler = null;
  }

  private async handleDeviceChange(): Promise<void> {
    if (!this.voiceChannelId) return;

    const track = this.rawInputStream?.getAudioTracks()[0];
    const trackDead = !track || track.readyState !== 'live';

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      if (inputs.length === 0) return;

      const currentId = track?.getSettings()?.deviceId;
      const currentStillPresent = Boolean(
        currentId && inputs.some((d) => d.deviceId === currentId)
      );

      if (trackDead || !currentStillPresent) {
        await this.recoverInputDevice();
      }
    } catch (error) {
      console.warn('🎙️ Ошибка обработки devicechange:', error);
    }
  }

  /** После отвала USB выбрать другой доступный микрофон и переподключить пайплайн. */
  async recoverInputDevice(): Promise<void> {
    if (!this.voiceChannelId || this.inputRecoveryInFlight) return;
    this.inputRecoveryInFlight = true;

    try {
      // Даем системе мгновение перечислить устройства после unplug
      await new Promise((r) => window.setTimeout(r, 200));

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      if (inputs.length === 0) {
        console.error('🎙️ Нет доступных микрофонов после отключения устройства');
        return;
      }

      const preferred = useAudioDeviceStore.getState().inputDeviceId;
      const next =
        (preferred &&
          preferred !== 'default' &&
          inputs.find((d) => d.deviceId === preferred)?.deviceId) ||
        inputs[0].deviceId;

      await this.switchInputDevice(next);
    } catch (error) {
      console.error('🎙️ Не удалось восстановить микрофон:', error);
    } finally {
      this.inputRecoveryInFlight = false;
    }
  }

  setMuted(muted: boolean) {
    this.isMuted = muted;

    // Учитываем режим рации: Mute — отдельный флажок, передача через applyTransmitGate
    this.applyTransmitGate();

    // Отправляем сообщение на сервер (состояние кнопки Mute, не факт передачи PTT)
    this.sendMessage({ type: 'mute', is_muted: muted });

    if (muted || (this.inputMode === 'push-to-talk' && !this.isPTTActive)) {
      this.setLocalSpeechDetected(false);
    }

    console.log(
      `🎙️ Микрофон ${muted ? 'заглушен' : 'включен'} (передача: ${
        this.canTransmitAudio() ? 'да' : 'нет'
      })`
    );
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
    void this.disconnectAsync();
  }

  /** Полный выход из голосового канала с ожиданием закрытия сокета. */
  async disconnectAsync(): Promise<void> {
    this.sessionId += 1;
    const wsToClose = this.ws;
    this.cleanup();

    if (!wsToClose || wsToClose.readyState === WebSocket.CLOSED) {
      return;
    }

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      const timer = globalThis.setTimeout(done, 300);
      try {
        wsToClose.addEventListener('close', () => {
          globalThis.clearTimeout(timer);
          done();
        }, { once: true });
        if (wsToClose.readyState !== WebSocket.CLOSING) {
          wsToClose.close(1000, 'User disconnected');
        }
      } catch {
        globalThis.clearTimeout(timer);
        done();
      }
    });
  }

  private cleanup() {
    console.log('🔊 Очистка VoiceService');

    this.stopDeviceWatch();
    this.ignoreInputTrackEnded = true;
    this.inputTrackEndedHandler = null;
    this.inputRecoveryInFlight = false;
    
    // Очищаем аудио обработку
    audioProcessingService.destroy();
    
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
    this.peerInitPromises.clear();
    this.peerGenerations.clear();
    this.recreateAttempts.clear();
    this.connectWatchdogExtends.clear();
    this.remoteConnectionIds.clear();
    this.mediaHealthMisses.clear();
    this.mediaHealthTimers.forEach((timer) => globalThis.clearTimeout(timer));
    this.mediaHealthTimers.clear();
    this.iceRestartTimers.forEach((timer) => globalThis.clearTimeout(timer));
    this.iceRestartTimers.clear();
    this.connectWatchdogs.forEach((timer) => globalThis.clearTimeout(timer));
    this.connectWatchdogs.clear();
    this.pendingIceCandidates.clear();
    this.pendingAnswers.clear();
    this.messageQueue = Promise.resolve();
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
    this.ignoreInputTrackEnded = false;

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
        
        // Только локальная подсказка: зелёную рамку собеседникам шлём
        // через applySpeakingIndicator (когда пакеты реально уходят по WebRTC).
        if (currentlySpeaking !== this.isSpeaking) {
          this.isSpeaking = currentlySpeaking;
          this.setLocalSpeechDetected(currentlySpeaking);
        }
      } catch (error) {
        console.error('🎙️ Ошибка при анализе голосовой активности:', error);
      }
    }, 50); // Проверяем каждые 50мс (было 100мс) для более быстрой реакции
  }

  private getCurrentUserId(): number | null {
    try {
      if (this.token) {
        const payload = JSON.parse(atob(this.token.split('.')[1]));
        const fromToken = Number(payload.sub);
        if (Number.isFinite(fromToken)) return fromToken;
      }
    } catch {
      // fallback ниже
    }
    const fromStore = useAuthStore.getState().user?.id;
    return typeof fromStore === 'number' ? fromStore : null;
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
    if (this.isMuted || this.isDeafened || !this.localSpeechDetected || !this.canTransmitAudio()) {
      this.applySpeakingIndicator(false);
      return;
    }

    // Без собеседников outbound RTP нет — рамка уже ставится в setLocalSpeechDetected
    if (!this.hasConnectedAudioPeer()) {
      this.applySpeakingIndicator(true);
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
      // Один в канале — всё равно показываем зелёную рамку (тестирование / PTT)
      if (!this.hasConnectedAudioPeer()) {
        this.applySpeakingIndicator(true);
        return;
      }

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
  async startScreenShare(options: StartScreenShareOptions = {}): Promise<boolean> {
    this.lastScreenShareStartCancelled = false;
    try {
      console.log('🖥️ Начинаем демонстрацию экрана', options);
      
      if (this.isScreenSharing) {
        console.log('🖥️ Пользователь уже демонстрирует экран');
        return false;
      }
      
      const streamSettings = useScreenShareSettingsStore.getState();
      const resolvedQuality = resolveQualitySettings(streamSettings);
      const electronCapture = getElectronCaptureConstraints(resolvedQuality);
      const isElectron = typeof window !== 'undefined' && !!window.electronAPI && typeof window.electronAPI.getDesktopSources === 'function';

      if (isElectron) {
        const sourceId = options.sourceId;
        if (!sourceId) {
          console.warn('🖥️ Electron: sourceId не передан');
          return false;
        }

        const buildConstraints = (withSystemAudio: boolean) => ({
          audio: withSystemAudio && !streamSettings.muteStreamAudio
            ? {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                }
              }
            : false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              ...electronCapture,
            }
          } as any
        }) as MediaStreamConstraints;

        try {
          this.screenStream = await navigator.mediaDevices.getUserMedia(buildConstraints(true));
        } catch (e) {
          console.warn('🖥️ Не удалось получить системный звук, пробуем без аудио', e);
          this.screenStream = await navigator.mediaDevices.getUserMedia(buildConstraints(false));
        }

        if (!this.screenStream || typeof (this.screenStream as any).getVideoTracks !== 'function') {
          throw new Error('Не удалось получить поток экрана');
        }
      } else {
        const videoConstraints: MediaTrackConstraints = {
          ...getDisplayMediaVideoConstraints(resolvedQuality),
        };

        if (options.preferDisplaySurface) {
          (videoConstraints as MediaTrackConstraints & { displaySurface?: string }).displaySurface =
            options.preferDisplaySurface;
        }

        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: !streamSettings.muteStreamAudio,
        });
      }

      const videoTrack = this.screenStream!.getVideoTracks()[0];
      if (videoTrack) {
        try {
          videoTrack.contentHint = resolvedQuality.contentHint;
        } catch {}
      }

      if (streamSettings.muteStreamAudio) {
        this.screenStream!.getAudioTracks().forEach((track) => {
          track.enabled = false;
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
      console.log(`🖥️ Стрим запущен: ${this.getStreamQualityLabel()}`);
      
      // Уведомляем сервер о начале демонстрации экрана
      this.sendMessage({ 
        type: 'screen_share_start'
      });

      // Отправляем локальное событие для обновления UI
      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
        let username = 'Вы';
        let display_name: string | undefined;
        try {
          const authUser = useAuthStore.getState().user;
          if (authUser?.id === currentUserId) {
            display_name = authUser.display_name;
            username = authUser.display_name?.trim() || authUser.username || 'Вы';
          } else if (this.token) {
            const payload = JSON.parse(atob(this.token.split('.')[1]));
            username = payload.username || 'Вы';
          }
        } catch (error) {
          console.warn('Не удалось получить имя пользователя:', error);
        }

        const event = new CustomEvent('screen_share_start', {
          detail: {
            user_id: currentUserId,
            username,
            display_name,
          },
        });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(event);
        }
        console.log('🖥️ Отправлено локальное событие screen_share_start для пользователя:', currentUserId);
      }

      console.log('🖥️ Демонстрация экрана успешно начата');
      soundService.playStreamStartSound();
      return true;
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'AbortError')
      ) {
        this.lastScreenShareStartCancelled = true;
      }
      console.error('🖥️ Ошибка начала демонстрации экрана:', error);
      return false;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    console.log('🖥️ Останавливаем демонстрацию экрана');
    soundService.playStreamEndSound();

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

  /** Зритель открыл стрим — уведомляем ведущего (звук + пере-offer с видео). */
  notifyStreamerViewerJoined(streamerId: number): void {
    const currentUserId = this.getCurrentUserId();
    if (!currentUserId || currentUserId === streamerId) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    const lastSent = this.lastViewerJoinedSent.get(streamerId) ?? 0;
    if (now - lastSent < 3000) return;
    this.lastViewerJoinedSent.set(streamerId, now);

    this.sendMessage({
      type: 'screen_share_viewer_joined',
      streamer_id: streamerId,
    });
  }

  /** Зритель: убедиться, что WebRTC-видео от стримера подключено. */
  async ensureRemoteScreenShare(streamerId: number): Promise<void> {
    const currentUserId = this.getCurrentUserId();
    if (!currentUserId || currentUserId === streamerId) return;

    const video = document.getElementById(`remote-video-${streamerId}`) as HTMLVideoElement | null;
    if (video?.srcObject) {
      const track = (video.srcObject as MediaStream).getVideoTracks()[0];
      if (track?.readyState === 'live' && video.videoWidth > 0) {
        return;
      }
    }

    if (this.screenShareEnsureTimers.has(streamerId)) return;

    this.notifyStreamerViewerJoined(streamerId);

    if (this.peerConnections.has(streamerId)) {
      this.requestOfferFromPeer(streamerId);
    }

    const timer = globalThis.setTimeout(() => {
      this.screenShareEnsureTimers.delete(streamerId);
    }, 2500);
    this.screenShareEnsureTimers.set(streamerId, timer);
  }

  private async refreshScreenShareOfferForViewer(viewerId: number): Promise<void> {
    const peer = this.peerConnections.get(viewerId);
    if (!peer?.pc || !this.screenStream) return;

    try {
      await this.updatePeerConnectionForScreenShare(peer.pc, viewerId);
    } catch (error) {
      console.warn(`🖥️ Не удалось обновить стрим для зрителя ${viewerId}:`, error);
    }
  }

  private attachRemoteVideoElement(remoteVideo: HTMLVideoElement, userId: number): void {
    const pool = document.getElementById('screen-share-video-pool');
    if (pool) {
      if (!pool.contains(remoteVideo)) {
        pool.appendChild(remoteVideo);
      }
      void remoteVideo.play().catch(() => {});
      console.log(`🖥️ Видео пользователя ${userId} добавлено в пул`);
      return;
    }

    if (!document.body.contains(remoteVideo)) {
      remoteVideo.style.position = 'fixed';
      remoteVideo.style.left = '-9999px';
      remoteVideo.style.width = '640px';
      remoteVideo.style.height = '360px';
      remoteVideo.style.opacity = '0.01';
      document.body.appendChild(remoteVideo);
    }
    void remoteVideo.play().catch(() => {});
    console.log(`🖥️ Видео пользователя ${userId} добавлено в body (fallback)`);
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

  wasLastScreenShareStartCancelled(): boolean {
    return this.lastScreenShareStartCancelled;
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

    const tasks: Promise<void>[] = [];
    this.peerConnections.forEach(({ pc }, userId) => {
      if (this.isScreenSharing) {
        tasks.push(this.applyScreenShareEncoding(pc, userId));
      } else {
        tasks.push(this.adjustVideoQuality(pc, userId, false));
      }
    });
    await Promise.all(tasks);
  }

  getStreamQualityLabel(): string {
    const settings = useScreenShareSettingsStore.getState();
    return formatStreamQualityLabel(resolveQualitySettings(settings));
  }

  async reapplyScreenShareQuality(): Promise<void> {
    if (!this.isScreenSharing || !this.screenStream) return;

    const settings = useScreenShareSettingsStore.getState();
    const resolved = resolveQualitySettings(settings);
    const videoTrack = this.screenStream.getVideoTracks()[0];

    if (videoTrack) {
      try {
        videoTrack.contentHint = resolved.contentHint;
      } catch {}
      try {
        await videoTrack.applyConstraints({
          frameRate: { ideal: resolved.fps, max: resolved.fps },
        });
      } catch (error) {
        console.warn('🖥️ Не удалось обновить FPS захвата, нужен перезапуск стрима:', error);
      }
    }

    this.screenStream.getAudioTracks().forEach((track) => {
      track.enabled = !settings.muteStreamAudio;
    });

    const tasks: Promise<void>[] = [];
    this.peerConnections.forEach(({ pc }, userId) => {
      tasks.push(this.applyScreenShareEncoding(pc, userId));
    });
    await Promise.all(tasks);
  }

  private async applyScreenShareEncoding(
    pc: RTCPeerConnection,
    userId: number
  ): Promise<void> {
    try {
      const videoSender = pc.getSenders().find((sender) => sender.track?.kind === 'video');
      if (!videoSender?.track) return;

      const settings = useScreenShareSettingsStore.getState();
      const resolved = resolveQualitySettings(settings);
      const trackSettings = videoSender.track.getSettings();
      const encoding = getScreenShareEncoding(resolved, trackSettings);

      const parameters = videoSender.getParameters();
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}];
      }

      Object.assign(parameters.encodings[0], encoding);
      await videoSender.setParameters(parameters);

      try {
        videoSender.track.contentHint = resolved.contentHint;
      } catch {}

      console.log(
        `🖥️ Качество стрима для ${userId}: ${formatStreamQualityLabel(resolved)}, ` +
          `${Math.round((encoding.maxBitrate ?? 0) / 1_000_000)} Mbps`
      );
    } catch (error) {
      console.warn(`🖥️ Не удалось применить качество стрима для ${userId}:`, error);
    }
  }

  /** Применить битрейт из настроек голосового канала (кбит/с). */
  public setChannelAudioBitrate(kbps: number): void {
    const next = Math.max(8, Math.min(96, Math.round(kbps || 64)));
    this.channelAudioBitrateKbps = next;
    void this.applyAudioBitrateToAllPeers();
  }

  private async applyAudioBitrateToPeer(pc: RTCPeerConnection): Promise<void> {
    const audioSenders = pc.getSenders().filter((sender) => sender.track?.kind === 'audio');
    const maxBitrate = this.channelAudioBitrateKbps * 1000;
    for (const sender of audioSenders) {
      try {
        const parameters = sender.getParameters();
        if (!parameters.encodings || parameters.encodings.length === 0) {
          parameters.encodings = [{}];
        }
        parameters.encodings[0].maxBitrate = maxBitrate;
        await sender.setParameters(parameters);
      } catch (error) {
        console.warn('[VoiceService] Не удалось задать битрейт аудио:', error);
      }
    }
  }

  private async applyAudioBitrateToAllPeers(): Promise<void> {
    const peers = Array.from(this.peerConnections.values());
    for (const peer of peers) {
      await this.applyAudioBitrateToPeer(peer.pc);
    }
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
      const iceReady =
        iceConnectionState === 'connected' || iceConnectionState === 'completed';
      
      let maxBitrate: number;
      let maxFramerate: number;
      
      if (isScreenShare) {
        return;
      } else {
        // Для обычного видео
        if (connectionState === 'connected' && iceReady) {
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

      // Настраиваем кодирование экрана по выбранному режиму
      await this.applyScreenShareEncoding(pc, userId);

      // Обрабатываем системный аудио трек
      const streamSettings = useScreenShareSettingsStore.getState();
      if (audioTracks.length > 0 && !streamSettings.muteStreamAudio) {
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
      const videoContainer = document.getElementById('screen-share-video-pool');
      
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
        console.log(`🖥️ Ожидание контейнера screen-share-video-pool (попытка ${attempts + 1}/50)`);
        setTimeout(() => waitForContainer(attempts + 1), 100);
      } else {
        // Превышено время ожидания
        console.error('🖥️ Превышено время ожидания контейнера screen-share-video-pool');
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
