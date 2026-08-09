import { formatStreamQualityLabel, getDisplayMediaVideoConstraints, getElectronCaptureConstraints, resolveQualitySettings } from '../../lib/screenShareQuality';
import { SCREEN_SHARE_VIDEO_POOL_ID } from '../../lib/screenShareVideo';
import { useAuthStore } from '../../store/store';
import { useScreenShareSettingsStore } from '../../store/screenShareSettingsStore';
import { useAudioDeviceStore } from '../../store/audioDeviceStore';
import { audioProcessingService } from '../audioProcessingService';
import unifiedWebSocketService from '../unifiedWebSocketService';
import { captureAudioStream, getVoiceSettingsSnapshot, sensitivityToDbfs, type VoiceSettingsSnapshot } from '../voiceSettings';
import { dispatchScreenShareState } from './screenShareEvents';
import { playScreenShareSound } from './screenShareSounds';
import { SfuTransport } from './sfuTransport';
import type { RemoteMedia, VoiceCallbacks, VoiceJoinedPayload, VoiceParticipant } from './types';

type StartScreenShareOptions = {
  sourceId?: string;
  preferDisplaySurface?: 'browser' | 'monitor' | 'window';
};

type PendingJoin = {
  resolve: (payload: VoiceJoinedPayload) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export class GroupVoiceController {
  private transport: SfuTransport | null = null;
  private currentChannelId: number | null = null;
  private rawInputStream: MediaStream | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private pendingJoin: PendingJoin | null = null;
  private callbacks: VoiceCallbacks = {};
  private participants = new Map<number, VoiceParticipant>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private screenTracks = new Map<number, Map<string, MediaStreamTrack>>();
  private screenSharingUsers = new Set<number>();
  private viewerJoinSentAt = new Map<number, number>();
  private participantVolumes = new Map<number, number>();
  private speakingUsers = new Set<number>();
  private isMuted = false;
  private isDeafened = false;
  private isSpeaking = false;
  private isScreenSharing = false;
  private lastScreenShareStartCancelled = false;
  private settings: VoiceSettingsSnapshot = getVoiceSettingsSnapshot();
  private pttActive = false;
  private pttReleaseTimer: number | null = null;
  private outputDeviceWarning: string | null = null;

  constructor() {
    this.bindGatewayEvents();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handlePttDown);
      window.addEventListener('keyup', this.handlePttUp);
    }
  }

  async joinVoiceChannel(channelId: number): Promise<void> {
    if (this.currentChannelId !== null) this.leaveVoiceChannel();
    this.settings = getVoiceSettingsSnapshot();
    this.applyRuntimeSettings(this.settings);
    this.currentChannelId = channelId;

    // Сигналинг уходит первым: список участников и статус появляются сразу,
    // пока микрофон и обработка звука ещё готовятся.
    const joined = this.waitForJoin();
    unifiedWebSocketService.joinVoiceChannel(channelId, this.isMuted, this.isDeafened);
    const microphone = this.prepareMicrophone().then(
      (track) => ({ ok: true as const, track }),
      (error) => ({ ok: false as const, error }),
    );

    try {
      const payload = await joined;

      this.participants = new Map(payload.participants.map((item) => [item.user_id, item]));
      this.callbacks.signalingJoined?.(payload.participants);
      this.callbacks.participantsReceived?.(payload.participants);
      for (const participant of payload.participants) {
        if (participant.is_sharing_screen) this.updateScreenShareState(participant.user_id, true, participant);
      }

      const result = await microphone;
      if (!result.ok) throw result.error;

      this.transport = this.createTransport();
      await this.transport.connect(payload.transport.ws_url, payload.transport.ticket, result.track);
      await this.applyTransmitGate();
    } catch (error) {
      // Микрофон мог открыться уже после ошибки сигналинга — дожидаемся, чтобы освободить его.
      await microphone;
      this.cleanupMedia();
      if (this.currentChannelId === channelId) unifiedWebSocketService.leaveVoiceChannel(channelId);
      this.currentChannelId = null;
      throw error;
    }
  }

  /** Захват микрофона и запуск обработки звука. Возвращает готовую аудиодорожку. */
  private async prepareMicrophone(): Promise<MediaStreamTrack> {
    this.rawInputStream = await captureAudioStream(this.settings.processing, this.settings.inputDeviceId);
    audioProcessingService.setOnSpeechStart(() => this.setLocalSpeaking(true));
    audioProcessingService.setOnSpeechEnd(() => this.setLocalSpeaking(false));
    // initialize() уже поднимает VAD — повторный refresh только удваивал загрузку модели.
    this.localStream = await audioProcessingService.initialize(this.rawInputStream, this.processingConfig(this.settings));
    audioProcessingService.setInputVolume(this.settings.inputVolume);
    const track = this.localStream.getAudioTracks()[0];
    if (!track) throw new Error('Микрофон не создал аудиодорожку.');
    return track;
  }

  leaveVoiceChannel(): void {
    const channelId = this.currentChannelId;
    if (channelId !== null) unifiedWebSocketService.leaveVoiceChannel(channelId);
    this.currentChannelId = null;
    this.cleanupMedia();
    this.participants.clear();
    this.speakingUsers.clear();
  }

  async setMuted(muted: boolean): Promise<void> {
    this.isMuted = muted;
    audioProcessingService.setMuted(muted);
    if (this.currentChannelId !== null) unifiedWebSocketService.updateMuteStatus(this.currentChannelId, muted);
    await this.applyTransmitGate();
  }

  async setDeafened(deafened: boolean): Promise<void> {
    this.isDeafened = deafened;
    await this.transport?.setDeafened(deafened);
    if (this.currentChannelId !== null) unifiedWebSocketService.updateDeafenStatus(this.currentChannelId, deafened);
  }

  toggleMute(): void { void this.setMuted(!this.isMuted); }
  toggleDeafen(): void { void this.setDeafened(!this.isDeafened); }

  async switchInputDevice(deviceId: string): Promise<void> {
    this.settings = { ...this.settings, inputDeviceId: deviceId };
    if (!this.transport) return;
    const nextRaw = await captureAudioStream(this.settings.processing, deviceId);
    const nextProcessed = await audioProcessingService.initialize(nextRaw, this.processingConfig(this.settings));
    const track = nextProcessed.getAudioTracks()[0];
    if (!track) throw new Error('Новое устройство не создало аудиодорожку.');
    this.rawInputStream?.getTracks().forEach((item) => item.stop());
    this.rawInputStream = nextRaw;
    this.localStream = nextProcessed;
    await this.transport.replaceMicrophoneTrack(track);
    audioProcessingService.setMuted(this.isMuted);
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    this.settings = { ...this.settings, outputDeviceId: deviceId };
    this.outputDeviceWarning = null;
    for (const audio of this.audioElements.values()) {
      if (!('setSinkId' in audio)) {
        this.outputDeviceWarning = 'Браузер не поддерживает выбор устройства вывода.';
        continue;
      }
      await (audio as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
    }
  }

  setParticipantVolume(userId: number, value: number): void {
    const volume = clamp(value);
    this.participantVolumes.set(userId, volume);
    for (const [key, element] of this.audioElements) {
      if (key.startsWith(`${userId}:`)) element.volume = volume * this.settings.outputVolume / 100;
    }
  }

  setInputVolume(value: number): void {
    this.settings = { ...this.settings, inputVolume: value };
    audioProcessingService.setInputVolume(value);
  }

  setOutputVolume(value: number): void {
    this.settings = { ...this.settings, outputVolume: value };
    useAudioDeviceStore.getState().setOutputVolume(value);
    for (const [key, element] of this.audioElements) {
      const userId = Number(key.split(':')[0]);
      element.volume = (this.participantVolumes.get(userId) ?? 1) * clamp(value / 100);
    }
  }

  setInputMode(mode: 'voice-activity' | 'push-to-talk'): void {
    this.settings = { ...this.settings, inputMode: mode };
    void this.applyTransmitGate();
  }

  setVADSensitivity(value: number): void {
    this.settings = { ...this.settings, vadSensitivity: value };
    audioProcessingService.updateVADThresholds(value);
  }

  setAutoDetectSensitivity(enabled: boolean): void {
    this.settings = { ...this.settings, autoDetectSensitivity: enabled };
  }

  setPTTKey(key: string): void { this.settings = { ...this.settings, pttKey: key }; }
  setPTTDelay(delay: number): void { this.settings = { ...this.settings, pttDelay: clamp(delay, 0, 2000) }; }

  async applySettings(settings: VoiceSettingsSnapshot): Promise<void> {
    const deviceChanged = settings.inputDeviceId !== this.settings.inputDeviceId;
    this.settings = settings;
    audioProcessingService.updateConfig(this.processingConfig(settings));
    this.setInputVolume(settings.inputVolume);
    this.setOutputVolume(settings.outputVolume);
    audioProcessingService.updateVADThresholds(settings.vadSensitivity);
    if (deviceChanged) await this.switchInputDevice(settings.inputDeviceId);
    await this.setOutputDevice(settings.outputDeviceId);
    await this.applyTransmitGate();
  }

  async startScreenShare(options: StartScreenShareOptions = {}): Promise<boolean> {
    this.lastScreenShareStartCancelled = false;
    if (!this.transport || this.isScreenSharing) return false;
    try {
      const stream = await this.captureScreen(options);
      this.screenStream = stream;
      await this.transport.startScreenShare(stream);
      this.isScreenSharing = true;
      const user = useAuthStore.getState().user;
      if (user) {
        this.attachScreenMedia(user.id, stream);
        this.updateScreenShareState(user.id, true, user);
      }
      if (this.currentChannelId !== null) unifiedWebSocketService.startScreenShare(this.currentChannelId);
      playScreenShareSound('start');
      return true;
    } catch (error) {
      this.lastScreenShareStartCancelled = error instanceof DOMException && error.name === 'NotAllowedError';
      this.screenStream?.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
      if (!this.lastScreenShareStartCancelled) throw error;
      return false;
    }
  }

  stopScreenShare(): void { void this.stopScreenShareNow(); }

  async ensureRemoteScreenShare(userId: number): Promise<void> {
    await this.transport?.ensureScreenShare(userId);
  }

  notifyStreamerViewerJoined(userId: number): void {
    const localUserId = useAuthStore.getState().user?.id;
    if (this.currentChannelId === null || localUserId == null || localUserId === userId) return;
    const now = Date.now();
    if (now - (this.viewerJoinSentAt.get(userId) ?? 0) < 3000) return;
    const sent = unifiedWebSocketService.send({
      type: 'screen_share_viewer_joined',
      voice_channel_id: this.currentChannelId,
      streamer_id: userId,
    });
    if (sent) this.viewerJoinSentAt.set(userId, now);
  }

  async reapplyScreenShareQuality(): Promise<void> {
    if (!this.screenStream) return;
    const resolved = resolveQualitySettings(useScreenShareSettingsStore.getState());
    const track = this.screenStream.getVideoTracks()[0];
    if (track) await track.applyConstraints(getDisplayMediaVideoConstraints(resolved)).catch(() => undefined);
  }

  getScreenSharingStatus(): boolean { return this.isScreenSharing; }
  wasLastScreenShareStartCancelled(): boolean { return this.lastScreenShareStartCancelled; }
  getStreamQualityLabel(): string { return formatStreamQualityLabel(resolveQualitySettings(useScreenShareSettingsStore.getState())); }
  getCurrentVolume(): number { return audioProcessingService.getCurrentVolume(); }
  updateVADThresholds(value: number): void { this.setVADSensitivity(value); }
  getIsMuted(): boolean { return this.isMuted; }
  getIsDeafened(): boolean { return this.isDeafened; }
  getIsSpeaking(): boolean { return this.isSpeaking; }
  getSpeakingUsers(): Set<number> { return new Set(this.speakingUsers); }
  getDiagnostics() {
    const diagnostics = audioProcessingService.getDiagnostics();
    return {
      ...diagnostics,
      unsupportedConstraints: this.outputDeviceWarning ? [...diagnostics.unsupportedConstraints, 'setSinkId'] : diagnostics.unsupportedConstraints,
      outputDeviceWarning: this.outputDeviceWarning,
      vadThresholdDbfs: sensitivityToDbfs(this.settings.vadSensitivity),
      transmitGateOpen: !this.isMuted && (this.settings.inputMode !== 'push-to-talk' || this.pttActive),
    };
  }

  onParticipantJoined(callback: NonNullable<VoiceCallbacks['participantJoined']>): void { this.callbacks.participantJoined = callback; }
  onParticipantLeft(callback: NonNullable<VoiceCallbacks['participantLeft']>): void { this.callbacks.participantLeft = callback; }
  onSpeakingChanged(callback: NonNullable<VoiceCallbacks['speakingChanged']>): void { this.callbacks.speakingChanged = callback; }
  onParticipantsReceived(callback: NonNullable<VoiceCallbacks['participantsReceived']>): void { this.callbacks.participantsReceived = callback; }
  onSignalingJoined(callback: NonNullable<VoiceCallbacks['signalingJoined']>): void { this.callbacks.signalingJoined = callback; }
  onParticipantStatusChanged(callback: NonNullable<VoiceCallbacks['participantStatusChanged']>): void { this.callbacks.participantStatusChanged = callback; }
  onScreenShareChanged(callback: NonNullable<VoiceCallbacks['screenShareChanged']>): void { this.callbacks.screenShareChanged = callback; }
  onScreenShareChange(callback: NonNullable<VoiceCallbacks['screenShareChanged']>): () => void {
    this.callbacks.screenShareChanged = callback;
    return () => { if (this.callbacks.screenShareChanged === callback) this.callbacks.screenShareChanged = undefined; };
  }
  onRemoteStream(callback: NonNullable<VoiceCallbacks['remoteStream']>): void { this.callbacks.remoteStream = callback; }

  private bindGatewayEvents(): void {
    unifiedWebSocketService.on('voice_joined', (data: VoiceJoinedPayload) => this.resolveJoin(data));
    unifiedWebSocketService.onUserJoinedVoice((data) => {
      const participant = data as VoiceParticipant;
      this.participants.set(participant.user_id, participant);
      this.callbacks.participantJoined?.(participant);
    });
    unifiedWebSocketService.onUserLeftVoice(({ user_id }) => {
      this.participants.delete(user_id);
      this.updateScreenShareState(user_id, false);
      this.removeRemoteUser(user_id);
      this.callbacks.participantLeft?.(user_id);
    });
    unifiedWebSocketService.onUserMuted((data) => this.callbacks.participantStatusChanged?.(data.user_id, { is_muted: data.is_muted }));
    unifiedWebSocketService.onUserDeafened((data) => this.callbacks.participantStatusChanged?.(data.user_id, { is_deafened: data.is_deafened }));
    unifiedWebSocketService.onUserSpeaking((data) => this.setRemoteSpeaking(data.user_id, data.is_speaking));
    unifiedWebSocketService.onScreenShareStarted((data) => this.updateScreenShareState(data.user_id, true, data));
    unifiedWebSocketService.onScreenShareStopped((data) => {
      this.updateScreenShareState(data.user_id, false, data);
      this.removeScreenMedia(data.user_id);
    });
    unifiedWebSocketService.on('screen_share_viewer_joined', (data: { streamer_id: number }) => {
      const localUserId = useAuthStore.getState().user?.id;
      if (this.isScreenSharing && localUserId === Number(data.streamer_id)) playScreenShareSound('join');
    });
    unifiedWebSocketService.on('error', (data: { code?: string; message?: string }) => {
      if (this.pendingJoin) this.rejectJoin(new Error(data.message || 'Не удалось войти в голосовой канал.'));
    });
  }

  private createTransport(): SfuTransport {
    const transport = new SfuTransport();
    transport.onRemoteMedia((media) => this.attachRemoteMedia(media));
    transport.onActiveSpeakers((userIds) => {
      const next = new Set(userIds);
      for (const userId of new Set([...this.speakingUsers, ...next])) this.setRemoteSpeaking(userId, next.has(userId));
    });
    transport.onFailure((message) => this.callbacks.connectionFailed?.(message));
    return transport;
  }

  private waitForJoin(): Promise<VoiceJoinedPayload> {
    this.rejectJoin(new Error('Новый вход в голосовой канал отменил предыдущий.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.rejectJoin(new Error('Медиасервис не ответил. Повторите подключение.')), 10_000);
      this.pendingJoin = { resolve, reject, timer };
    });
  }

  private resolveJoin(payload: VoiceJoinedPayload): void {
    if (!this.pendingJoin || payload.channel_id !== this.currentChannelId || payload.protocol_version !== 1) return;
    const pending = this.pendingJoin;
    this.pendingJoin = null;
    clearTimeout(pending.timer);
    pending.resolve(payload);
  }

  private rejectJoin(error: Error): void {
    if (!this.pendingJoin) return;
    const pending = this.pendingJoin;
    this.pendingJoin = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private processingConfig(settings: VoiceSettingsSnapshot) {
    return {
      vadEnabled: true,
      noiseSuppression: settings.processing.noiseSuppression,
      noiseSuppressionEngine: settings.processing.noiseSuppressionEngine,
      echoCancellation: settings.processing.echoCancellation,
      autoGainControl: settings.processing.autoGainControl,
      voiceConditioning: settings.processing.voiceConditioning,
      useAdvancedNoiseSuppression: settings.processing.noiseSuppression && settings.processing.noiseSuppressionEngine !== 'browser',
      speechProbabilityThreshold: clamp(settings.vadSensitivity / 100, 0.1, 0.9),
    };
  }

  private applyRuntimeSettings(settings: VoiceSettingsSnapshot): void {
    this.settings = settings;
    audioProcessingService.updateVADThresholds(settings.vadSensitivity);
  }

  private setLocalSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
    if (this.currentChannelId !== null) unifiedWebSocketService.updateSpeakingStatus(this.currentChannelId, speaking);
    this.callbacks.speakingChanged?.(null, speaking);
  }

  private setRemoteSpeaking(userId: number, speaking: boolean): void {
    if (speaking) this.speakingUsers.add(userId); else this.speakingUsers.delete(userId);
    this.callbacks.speakingChanged?.(userId, speaking);
  }

  private updateScreenShareState(
    userId: number,
    sharing: boolean,
    identity: Partial<VoiceParticipant> = {},
  ): void {
    if (!Number.isFinite(userId) || this.screenSharingUsers.has(userId) === sharing) return;
    if (sharing) this.screenSharingUsers.add(userId);
    else {
      this.screenSharingUsers.delete(userId);
      this.transport?.clearScreenShareRequest(userId);
    }
    const localUser = useAuthStore.getState().user;
    const participant = this.participants.get(userId);
    const username = identity.display_name?.trim()
      || identity.username?.trim()
      || participant?.display_name?.trim()
      || participant?.username?.trim()
      || (localUser?.id === userId ? localUser.display_name?.trim() || localUser.username : '')
      || `User ${userId}`;
    dispatchScreenShareState({
      user_id: userId,
      username,
      display_name: identity.display_name || participant?.display_name,
      avatar_url: identity.avatar_url || participant?.avatar_url,
      is_sharing_screen: sharing,
      voice_channel_id: this.currentChannelId,
    });
    this.callbacks.screenShareChanged?.(userId, sharing);
  }

  private async applyTransmitGate(): Promise<void> {
    const gated = this.isMuted || (this.settings.inputMode === 'push-to-talk' && !this.pttActive);
    audioProcessingService.setMuted(gated);
    await this.transport?.setMicrophoneMuted(gated);
  }

  private handlePttDown = (event: KeyboardEvent): void => {
    if (this.settings.inputMode !== 'push-to-talk' || event.repeat || event.code !== this.settings.pttKey) return;
    if (this.pttReleaseTimer !== null) window.clearTimeout(this.pttReleaseTimer);
    this.pttActive = true;
    void this.applyTransmitGate();
  };

  private handlePttUp = (event: KeyboardEvent): void => {
    if (this.settings.inputMode !== 'push-to-talk' || event.code !== this.settings.pttKey) return;
    this.pttReleaseTimer = window.setTimeout(() => {
      this.pttActive = false;
      void this.applyTransmitGate();
    }, this.settings.pttDelay);
  };

  private attachRemoteMedia(media: RemoteMedia): void {
    if (media.source === 'microphone' || media.source === 'screen-audio') {
      const key = `${media.userId}:${media.source}`;
      const audio = this.audioElements.get(key) ?? document.createElement('audio');
      audio.id = `remote-audio-${media.userId}-${media.source}`;
      audio.autoplay = true;
      audio.srcObject = media.stream;
      audio.volume = (this.participantVolumes.get(media.userId) ?? 1) * this.settings.outputVolume / 100;
      this.audioElements.set(key, audio);
      void this.setOutputDevice(this.settings.outputDeviceId).catch(() => undefined);
      void audio.play().catch(() => undefined);
    }
    if (media.source.startsWith('screen-')) this.attachScreenMedia(media.userId, media.stream);
    this.callbacks.remoteStream?.(media.userId, this.transport?.getRemoteStream(media.userId) ?? media.stream);
    this.callbacks.remoteMedia?.(media);
  }

  private attachScreenMedia(userId: number, stream: MediaStream): void {
    const tracks = this.screenTracks.get(userId) ?? new Map<string, MediaStreamTrack>();
    for (const track of stream.getTracks()) tracks.set(track.kind, track);
    this.screenTracks.set(userId, tracks);
    let video = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement | null;
    if (!video) {
      video = document.createElement('video');
      video.id = `remote-video-${userId}`;
      video.autoplay = true;
      video.playsInline = true;
      const pool = document.getElementById(SCREEN_SHARE_VIDEO_POOL_ID);
      pool?.appendChild(video);
    }
    video.srcObject = new MediaStream([...tracks.values()]);
    void video.play().catch(() => undefined);
  }

  private removeScreenMedia(userId: number): void {
    this.screenTracks.delete(userId);
    const video = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement | null;
    if (video) { video.srcObject = null; video.remove(); }
  }

  private removeRemoteUser(userId: number): void {
    for (const [key, audio] of this.audioElements) {
      if (!key.startsWith(`${userId}:`)) continue;
      audio.srcObject = null;
      audio.remove();
      this.audioElements.delete(key);
    }
    this.removeScreenMedia(userId);
  }

  private async captureScreen(options: StartScreenShareOptions): Promise<MediaStream> {
    const settings = useScreenShareSettingsStore.getState();
    const resolved = resolveQualitySettings(settings);
    const electron = typeof window !== 'undefined' && !!window.electronAPI?.getDesktopSources;
    let stream: MediaStream;
    if (electron) {
      if (!options.sourceId) throw new Error('Не выбран источник демонстрации.');
      const constraints = (audio: boolean): MediaStreamConstraints => ({
        audio: audio && !settings.muteStreamAudio ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: options.sourceId } } as MediaTrackConstraints : false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: options.sourceId, ...getElectronCaptureConstraints(resolved) } } as MediaTrackConstraints,
      });
      try { stream = await navigator.mediaDevices.getUserMedia(constraints(true)); }
      catch { stream = await navigator.mediaDevices.getUserMedia(constraints(false)); }
    } else {
      const video = getDisplayMediaVideoConstraints(resolved) as MediaTrackConstraints & { displaySurface?: string };
      if (options.preferDisplaySurface) video.displaySurface = options.preferDisplaySurface;
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: !settings.muteStreamAudio });
    }
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Источник не создал видеодорожку.');
    track.contentHint = resolved.contentHint;
    track.addEventListener('ended', () => this.stopScreenShare(), { once: true });
    return stream;
  }

  private async stopScreenShareNow(): Promise<void> {
    if (!this.isScreenSharing && !this.screenStream) return;
    const stream = this.screenStream;
    this.screenStream = null;
    this.isScreenSharing = false;
    await this.transport?.stopScreenShare();
    stream?.getTracks().forEach((track) => track.stop());
    const userId = useAuthStore.getState().user?.id;
    if (userId != null) {
      this.updateScreenShareState(userId, false);
      this.removeScreenMedia(userId);
    }
    if (this.currentChannelId !== null) unifiedWebSocketService.stopScreenShare(this.currentChannelId);
    playScreenShareSound('stop');
  }

  private cleanupMedia(): void {
    const wasScreenSharing = this.isScreenSharing;
    this.rejectJoin(new Error('Подключение отменено.'));
    this.transport?.close();
    this.transport = null;
    this.rawInputStream?.getTracks().forEach((track) => track.stop());
    this.rawInputStream = null;
    this.localStream = null;
    this.screenStream?.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
    this.isScreenSharing = false;
    this.viewerJoinSentAt.clear();
    for (const userId of [...this.screenSharingUsers]) this.updateScreenShareState(userId, false);
    void audioProcessingService.destroy();
    for (const userId of [...this.screenTracks.keys()]) this.removeScreenMedia(userId);
    for (const userId of [...this.participants.keys()]) this.removeRemoteUser(userId);
    if (wasScreenSharing) playScreenShareSound('stop');
  }
}

export const groupVoiceController = new GroupVoiceController();
export default groupVoiceController;
