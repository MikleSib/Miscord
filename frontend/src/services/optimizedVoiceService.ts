/**
 * Оптимизированный голосовой сервис
 * Использует единый унифицированный WebSocket для WebRTC сигналинга
 */

import unifiedWebSocketService from './unifiedWebSocketService';
import { audioProcessingService } from './audioProcessingService';
import {
  captureAudioStream,
  getVoiceSettingsSnapshot,
  sensitivityToDbfs,
  calculateAutoThreshold,
  normalizePTTDelay,
  shouldTransmit,
  type VoiceSettingsSnapshot,
} from './voiceSettings';
import soundService from './soundService';
import { advancedNoiseGate } from './advancedNoiseGate';
import { useAudioDeviceStore } from '../store/audioDeviceStore';

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
  private rawInputStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peerConnections: Map<number, PeerConnection> = new Map();
  private pendingIceCandidates: Map<number, RTCIceCandidateInit[]> = new Map();
  private iceServers: RTCIceServer[] = [];
  private currentVoiceChannelId: number | null = null;
  
  // Callbacks
  private onParticipantJoinedCallback: ((participant: VoiceParticipant) => void) | null = null;
  private onParticipantLeftCallback: ((userId: number) => void) | null = null;
  private onSpeakingChangedCallback: ((userId: number | null, isSpeaking: boolean) => void) | null = null;
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
  private remoteAudioElements: Map<number, HTMLAudioElement> = new Map();
  
  // VAD
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: NodeJS.Timeout | null = null;
  private vadThreshold: number = 50;
  private inputMode: 'voice-activity' | 'push-to-talk' = 'voice-activity';
  private pttKey: string = 'Space';
  private isPTTActive: boolean = false;
  private pttDelay = 0;
  private pttReleaseTimer: number | null = null;
  private autoDetectSensitivity = true;
  private vadActive = false;
  private vadAttackFrames = 0;
  private vadReleaseFrames = 0;
  private vadCalibrationSamples: number[] = [];
  private autoVadThresholdDbfs = -45;
  private lastInputLevel = 0;
  private transmitGateOpen = false;
  private outputDeviceWarning: string | null = null;
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
    const settings = getVoiceSettingsSnapshot();
    this.applyRuntimeSettings(settings);
    console.log('[OptimizedVoice] 🎤 Присоединение к каналу:', channelId);

    try {
      // Получаем локальный поток
      this.rawInputStream = await captureAudioStream(
        settings.processing,
        settings.inputDeviceId,
      );
      const processedStream = await audioProcessingService.initialize(
        this.rawInputStream,
        {
          noiseSuppression: settings.processing.noiseSuppression,
          echoCancellation: settings.processing.echoCancellation,
          autoGainControl: settings.processing.autoGainControl,
          voiceConditioning: settings.processing.voiceConditioning,
          useAdvancedNoiseSuppression:
            settings.processing.noiseSuppression &&
            settings.processing.noiseSuppressionEngine !== 'browser',
          noiseSuppressionEngine:
            settings.processing.noiseSuppressionEngine,
        },
      );
      this.localStream = processedStream;
      audioProcessingService.setInputVolume(settings.inputVolume);

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
      void this.attachRemoteAudio(userId, stream);
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
    this.removeRemoteAudio(userId);
  }

  /**
   * Инициализация аудио обработки и VAD
   */
  private async initializeAudioProcessing(): Promise<void> {
    const analysisStream = this.rawInputStream ?? this.localStream;
    if (!analysisStream) return;

    try {
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
      }
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(analysisStream);
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.12;


      source.connect(this.analyser);

      // Запускаем VAD если включен
      this.startVAD();
      this.applyTransmitGate();

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

    const samples = new Float32Array(this.analyser?.fftSize ?? 1024);
    this.vadInterval = setInterval(() => {
      if (!this.analyser) return;

      this.analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const dbfs = 20 * Math.log10(Math.max(rms, 1e-8));
      this.lastInputLevel = Math.max(0, Math.min(1, rms * 5));

      if (this.autoDetectSensitivity && !this.vadActive) {
        this.vadCalibrationSamples.push(dbfs);
        if (this.vadCalibrationSamples.length > 100) {
          this.vadCalibrationSamples.shift();
        }
        this.autoVadThresholdDbfs = calculateAutoThreshold(
          this.vadCalibrationSamples,
        );
      }

      const threshold = this.autoDetectSensitivity
        ? this.autoVadThresholdDbfs
        : sensitivityToDbfs(this.vadThreshold);
      const aboveThreshold = dbfs >= threshold;

      if (aboveThreshold) {
        this.vadAttackFrames += 1;
        this.vadReleaseFrames = 0;
        if (this.vadAttackFrames >= 3) this.vadActive = true;
      } else {
        this.vadAttackFrames = 0;
        this.vadReleaseFrames += 1;
        if (this.vadReleaseFrames >= 10) this.vadActive = false;
      }

      this.applyTransmitGate();
    }, 20);
  }

  private applyTransmitGate(): void {
    const open = shouldTransmit(
      this.isMuted,
      this.inputMode,
      this.vadActive,
      this.isPTTActive,
    );
    audioProcessingService.setMuted(!open);

    if (open === this.transmitGateOpen) return;
    this.transmitGateOpen = open;
    this.isSpeaking = open;
    this.onSpeakingChangedCallback?.(null, open);
    if (this.currentVoiceChannelId) {
      unifiedWebSocketService.updateSpeakingStatus(
        this.currentVoiceChannelId,
        open,
      );
    }
  }

  /**
   * Остановка VAD
   */
  private stopVAD(): void {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    this.vadActive = false;
    this.vadAttackFrames = 0;
    this.vadReleaseFrames = 0;
    this.applyTransmitGate();
  }

  /**
   * Остановка локального потока
   */
  private stopLocalStream(): void {
    this.clearPTTReleaseTimer();
    this.removePTTHandlers();
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    void audioProcessingService.destroy();

    if (this.rawInputStream) {
      this.rawInputStream.getTracks().forEach(track => track.stop());
      this.rawInputStream = null;
    }

    this.stopVAD();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // ==================== PUBLIC API ====================

  public setInputVolume(volume: number): void {
    const nextVolume = Math.min(100, Math.max(0, volume));
    useAudioDeviceStore.getState().setInputVolume(nextVolume);
    audioProcessingService.setInputVolume(nextVolume);
  }

  public setOutputVolume(volume: number): void {
    const nextVolume = Math.min(100, Math.max(0, volume));
    useAudioDeviceStore.getState().setOutputVolume(nextVolume);
    this.remoteAudioElements.forEach((audio) => {
      audio.volume = nextVolume / 100;
    });
  }

  public async setOutputDevice(deviceId: string): Promise<void> {
    const nextDeviceId = deviceId || 'default';
    if (
      nextDeviceId !== 'default' &&
      !('setSinkId' in HTMLMediaElement.prototype)
    ) {
      this.outputDeviceWarning =
        'Этот браузер не поддерживает выбор устройства вывода (setSinkId).';
      throw new Error(this.outputDeviceWarning);
    }
    const sinkId = nextDeviceId === 'default' ? '' : nextDeviceId;
    await Promise.all(Array.from(this.remoteAudioElements.values()).map(async (audio) => {
      const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (!sinkAudio.setSinkId) return;
      await sinkAudio.setSinkId(sinkId);
    }));
    useAudioDeviceStore.getState().setOutputDeviceId(nextDeviceId);
    this.outputDeviceWarning = null;
  }

  public async switchInputDevice(deviceId: string): Promise<void> {
    const nextDeviceId = deviceId || 'default';
    if (!this.currentVoiceChannelId) {
      useAudioDeviceStore.getState().setInputDeviceId(nextDeviceId);
      return;
    }

    const settings = getVoiceSettingsSnapshot();
    const nextRawStream = await captureAudioStream(
      settings.processing,
      nextDeviceId,
    );

    const previousLocalStream = this.localStream;
    const previousRawStream = this.rawInputStream;
    this.stopVAD();
    if (this.audioContext) await this.audioContext.close();
    this.audioContext = null;
    this.analyser = null;
    this.analyser = null;
    this.rawInputStream = nextRawStream;
    const processedStream = await audioProcessingService.initialize(
      nextRawStream,
      {
        noiseSuppression: settings.processing.noiseSuppression,
        echoCancellation: settings.processing.echoCancellation,
        autoGainControl: settings.processing.autoGainControl,
        voiceConditioning: settings.processing.voiceConditioning,
        useAdvancedNoiseSuppression:
          settings.processing.noiseSuppression &&
          settings.processing.noiseSuppressionEngine !== 'browser',
        noiseSuppressionEngine:
          settings.processing.noiseSuppressionEngine,
      },
    );
    this.localStream = processedStream;
    audioProcessingService.setInputVolume(useAudioDeviceStore.getState().inputVolume ?? 100);
    await this.initializeAudioProcessing();

    const nextTrack = this.localStream?.getAudioTracks()[0] ?? null;
    await Promise.all(Array.from(this.peerConnections.values()).map(async ({ pc }) => {
      const sender = pc.getSenders().find((candidate) => candidate.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(nextTrack);
    }));

    previousLocalStream?.getTracks().forEach((track) => track.stop());
    if (previousRawStream !== previousLocalStream) {
      previousRawStream?.getTracks().forEach((track) => track.stop());
    }

    const actualDeviceId = nextRawStream.getAudioTracks()[0]?.getSettings().deviceId;
    const selectedDeviceId =
      nextDeviceId === 'default' || actualDeviceId === nextDeviceId
        ? nextDeviceId
        : 'default';
    useAudioDeviceStore
      .getState()
      .setInputDeviceId(selectedDeviceId);
  }

  private async attachRemoteAudio(userId: number, stream: MediaStream): Promise<void> {
    let audio = this.remoteAudioElements.get(userId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      audio.id = `optimized-remote-audio-${userId}`;
      this.remoteAudioElements.set(userId, audio);
    }

    const audioState = useAudioDeviceStore.getState();
    audio.srcObject = stream;
    audio.volume = audioState.outputVolume / 100;
    audio.muted = this.isDeafened;

    const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkAudio.setSinkId) {
      const sinkId = audioState.outputDeviceId === 'default' ? '' : audioState.outputDeviceId;
      await sinkAudio.setSinkId(sinkId).catch(() => undefined);
    }
    await audio.play().catch(() => undefined);
  }

  private removeRemoteAudio(userId: number): void {
    const audio = this.remoteAudioElements.get(userId);
    if (!audio) return;
    audio.pause();
    audio.srcObject = null;
    this.remoteAudioElements.delete(userId);
  }

  public toggleMute(): boolean {
    return this.setMuted(!this.isMuted);
  }

  public setMuted(muted: boolean): boolean {
    this.isMuted = muted;
    if (muted) {
      this.clearPTTReleaseTimer();
      this.isPTTActive = false;
    }
    this.applyTransmitGate();
    if (this.currentVoiceChannelId) {
      unifiedWebSocketService.updateMuteStatus(
        this.currentVoiceChannelId,
        this.isMuted,
      );
    }
    return this.isMuted;
  }

  public toggleDeafen(): boolean {
    return this.setDeafened(!this.isDeafened);
  }

  public setDeafened(deafened: boolean): boolean {
    this.isDeafened = deafened;
    this.remoteAudioElements.forEach((audio) => {
      audio.muted = this.isDeafened;
    });
    if (this.currentVoiceChannelId) {
      unifiedWebSocketService.updateDeafenStatus(
        this.currentVoiceChannelId,
        this.isDeafened,
      );
    }
    return this.isDeafened;
  }

  public updateVADThresholds(sensitivity: number): void {
    this.setVADSensitivity(sensitivity);
  }

  public setVADSensitivity(sensitivity: number): void {
    this.vadThreshold = Math.max(0, Math.min(100, sensitivity));
  }

  public setAutoDetectSensitivity(enabled: boolean): void {
    this.autoDetectSensitivity = enabled;
    this.vadCalibrationSamples = [];
    this.autoVadThresholdDbfs = -45;
  }

  public setInputMode(mode: 'voice-activity' | 'push-to-talk'): void {
    this.inputMode = mode;
    if (mode === 'voice-activity') {
      this.removePTTHandlers();
      this.isPTTActive = false;
    } else {
      this.vadActive = false;
      this.setupPTTHandlers();
    }
    this.startVAD();
    this.applyTransmitGate();
  }

  public setPTTKey(key: string): void {
    this.pttKey = key;
    if (this.inputMode === 'push-to-talk') {
      this.setupPTTHandlers();
    }
  }

  public setPTTDelay(delay: number): void {
    this.pttDelay = normalizePTTDelay(delay);
  }
  private setupPTTHandlers(): void {
    this.removePTTHandlers();
    this.pttKeyHandler = (event: KeyboardEvent) => {
      if (event.code !== this.pttKey) return;
      event.preventDefault();

      if (event.type === 'keydown') {
        this.clearPTTReleaseTimer();
        if (!this.isPTTActive) {
          this.isPTTActive = true;
          this.applyTransmitGate();
        }
        return;
      }

      this.clearPTTReleaseTimer();
      const release = () => {
        this.isPTTActive = false;
        this.applyTransmitGate();
      };
      if (this.pttDelay === 0) {
        release();
      } else {
        this.pttReleaseTimer = window.setTimeout(release, this.pttDelay);
      }
    };

    window.addEventListener('keydown', this.pttKeyHandler);
    window.addEventListener('keyup', this.pttKeyHandler);
  }

  private removePTTHandlers(): void {
    this.clearPTTReleaseTimer();
    if (this.pttKeyHandler) {
      window.removeEventListener('keydown', this.pttKeyHandler);
      window.removeEventListener('keyup', this.pttKeyHandler);
      this.pttKeyHandler = null;
    }
  }

  private clearPTTReleaseTimer(): void {
    if (this.pttReleaseTimer !== null) {
      window.clearTimeout(this.pttReleaseTimer);
      this.pttReleaseTimer = null;
    }
  }

  private applyRuntimeSettings(settings: VoiceSettingsSnapshot): void {
    this.vadThreshold = settings.vadSensitivity;
    this.autoDetectSensitivity = settings.autoDetectSensitivity;
    this.pttKey = settings.pttKey;
    this.pttDelay = settings.pttDelay;
    this.inputMode = settings.inputMode;

    if (this.inputMode === 'push-to-talk') {
      this.setupPTTHandlers();
    } else {
      this.removePTTHandlers();
    }
  }

  public async applySettings(settings: VoiceSettingsSnapshot): Promise<void> {
    this.applyRuntimeSettings(settings);
    audioProcessingService.setInputVolume(settings.inputVolume);
    audioProcessingService.updateConfig({
      echoCancellation: settings.processing.echoCancellation,
      autoGainControl: settings.processing.autoGainControl,
      voiceConditioning: settings.processing.voiceConditioning,
    });
    await audioProcessingService.setNoiseSuppression(
      settings.processing.noiseSuppression,
      settings.processing.noiseSuppressionEngine,
    );
    this.setOutputVolume(settings.outputVolume);
    try {
      await this.setOutputDevice(settings.outputDeviceId);
    } catch (error) {
      console.warn('[OptimizedVoice] Output device setting was not applied:', error);
    }
    this.startVAD();
    this.applyTransmitGate();
  }

  public getCurrentVolume(): number {
    return this.lastInputLevel;
  }

  public getDiagnostics() {
    const diagnostics = audioProcessingService.getDiagnostics();
    return {
      ...diagnostics,
      unsupportedConstraints: this.outputDeviceWarning
        ? [...diagnostics.unsupportedConstraints, 'setSinkId']
        : diagnostics.unsupportedConstraints,
      outputDeviceWarning: this.outputDeviceWarning,
      vadThresholdDbfs: this.autoDetectSensitivity
        ? this.autoVadThresholdDbfs
        : sensitivityToDbfs(this.vadThreshold),
      transmitGateOpen: this.transmitGateOpen,
    };
  }
  // ==================== CALLBACKS ====================

  public onParticipantJoined(callback: (participant: VoiceParticipant) => void): void {
    this.onParticipantJoinedCallback = callback;
  }

  public onParticipantLeft(callback: (userId: number) => void): void {
    this.onParticipantLeftCallback = callback;
  }

  public onSpeakingChanged(callback: (userId: number | null, isSpeaking: boolean) => void): void {
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

