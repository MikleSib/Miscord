import { formatStreamQualityLabel, getDisplayMediaVideoConstraints, resolveQualitySettings } from '../../lib/screenShareQuality';
import { useAuthStore } from '../../store/store';
import { useScreenShareSettingsStore } from '../../store/screenShareSettingsStore';
import { useAudioDeviceStore } from '../../store/audioDeviceStore';
import { audioProcessingService } from '../audioProcessingService';
import unifiedWebSocketService from '../unifiedWebSocketService';
import { getVoiceSettingsSnapshot, sensitivityToDbfs, type VoiceSettingsSnapshot } from '../voiceSettings';
import { dispatchScreenShareState } from './screenShareEvents';
import { playScreenShareSound } from './screenShareSounds';
import { prepareGroupVoiceInput, switchGroupVoiceInput } from './groupVoiceInputSwitch';
import { GroupVoiceInputState } from './groupVoiceInputState';
import { GroupVoiceJoinWaiter } from './groupVoiceJoinWaiter';
import { GroupVoiceMonitor } from './groupVoiceMonitor';
import { GroupVoiceOutputSwitch } from './groupVoiceOutputSwitch';
import { attachScreenMedia, GroupVoiceScreenLifecycle, removeScreenMedia, type StartScreenShareOptions } from './groupVoiceScreen';
import { buildGroupVoiceProcessingConfig } from './groupVoiceProcessing';
import { GroupVoiceActivityGate } from './groupVoiceActivityGate';
import { SfuTransport } from './sfuTransport';
import type { RemoteMedia, VoiceCallbacks, VoiceJoinedPayload, VoiceParticipant } from './types';
import { VoiceLifecycle, type AssertCurrentVoiceLifecycle } from './voiceLifecycle';
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export class GroupVoiceController {
  private transport: SfuTransport | null = null;
  private currentChannelId: number | null = null;
  private rawInputStream: MediaStream | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private readonly joinWaiter = new GroupVoiceJoinWaiter();
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
  private readonly monitor = new GroupVoiceMonitor();
  private readonly inputState = new GroupVoiceInputState(this.settings.inputDeviceId);
  private activeJoinPromise: Promise<void> | null = null;
  private cleanupRequired = false;
  private readonly lifecycle = new VoiceLifecycle();
  private readonly outputSwitch = new GroupVoiceOutputSwitch();
  private readonly screenLifecycle = new GroupVoiceScreenLifecycle();
  private readonly activityGate = new GroupVoiceActivityGate(() => { void this.applyTransmitGate(); });
  constructor() {
    this.bindGatewayEvents();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handlePttDown);
      window.addEventListener('keyup', this.handlePttUp);
    }
  }
  joinVoiceChannel(channelId: number): Promise<void> {
    this.joinWaiter.reject(new Error('Новый вход в голосовой канал отменил предыдущий.'));
    this.preemptOwnedMedia();
    const promise = this.lifecycle.runLatest((assertCurrent) => this.joinVoiceChannelNow(channelId, assertCurrent));
    this.activeJoinPromise = promise;
    void promise.then(
      () => { if (this.activeJoinPromise === promise) this.activeJoinPromise = null; },
      () => { if (this.activeJoinPromise === promise) this.activeJoinPromise = null; },
    );
    return promise;
  }
  private async joinVoiceChannelNow(channelId: number, assertCurrent: AssertCurrentVoiceLifecycle): Promise<void> {
    assertCurrent();
    if (this.currentChannelId !== null || this.cleanupRequired) await this.leaveVoiceChannelNow(false);
    assertCurrent();
    this.inputState.joining = true;
    const snapshot = getVoiceSettingsSnapshot();
    this.settings = this.inputState.revision > 0
      ? { ...snapshot, inputDeviceId: this.settings.inputDeviceId }
      : snapshot;
    this.applyRuntimeSettings(this.settings);
    this.currentChannelId = channelId;
    const microphone = this.prepareMicrophone(assertCurrent).then(
      (input) => ({ ok: true as const, input }),
      (error) => ({ ok: false as const, error }),
    );

    try {
      await unifiedWebSocketService.waitUntilReady(); assertCurrent();
      unifiedWebSocketService.joinVoiceChannel(channelId, this.isMuted, this.isDeafened);
      const joined = this.joinWaiter.wait();
      const payload = await joined;
      assertCurrent();

      this.participants = new Map(payload.participants.map((item) => [item.user_id, item]));
      this.callbacks.signalingJoined?.(payload.participants);
      this.callbacks.participantsReceived?.(payload.participants);
      for (const participant of payload.participants) {
        if (participant.is_sharing_screen) this.updateScreenShareState(participant.user_id, true, participant);
      }

      const result = await microphone;
      if (!result.ok) throw result.error;
      assertCurrent();

      this.transport = this.createTransport();
      const initiallyGated = this.isTransportGated();
      audioProcessingService.setMuted(this.monitor.active ? false : this.isTransmitGated());
      await this.transport.setMicrophoneMuted(initiallyGated);
      await this.transport.setDeafened(this.isDeafened);
      await this.transport.connect(
        payload.transport.ws_url, payload.transport.ticket,
        result.input.track, initiallyGated,
        { userId: payload.self.user_id, sessionId: payload.session_id },
      );
      assertCurrent();
      await this.transport.setDeafened(this.isDeafened);
      await this.reconcileJoiningInput(assertCurrent);
      await this.applyTransmitGate();
      await this.reconcileJoiningInput(assertCurrent);
      this.inputState.joining = false;
    } catch (error) {
      await microphone;
      await this.cleanupMedia();
      if (this.currentChannelId === channelId) unifiedWebSocketService.leaveVoiceChannel(channelId);
      this.currentChannelId = null;
      this.inputState.joining = false;
      this.inputState.reject(error instanceof Error ? error : new Error(String(error)));
      this.settings = { ...this.settings, inputDeviceId: this.inputState.appliedDeviceId };
      throw error;
    }
  }
  private async prepareMicrophone(assertCurrent: AssertCurrentVoiceLifecycle) {
    audioProcessingService.setOnSpeechStart(() => this.setLocalSpeaking(true));
    audioProcessingService.setOnSpeechEnd(() => this.setLocalSpeaking(false));
    audioProcessingService.setOnInputLevel((dbfs) => this.activityGate.updateInputLevel(dbfs));
    const input = await prepareGroupVoiceInput({
      getSettings: () => ({ ...this.settings, inputDeviceId: this.inputState.desiredDeviceId }),
      getRevision: () => this.inputState.revision,
      assertLifecycleCurrent: assertCurrent,
      onApplied: (next) => {
        this.applyInput(next.raw, next.processed, next.deviceId, next.revision);
        useAudioDeviceStore.getState().setInputDeviceId(next.deviceId);
        this.inputState.resolve(next.revision);
      },
    });
    audioProcessingService.setInputVolume(this.settings.inputVolume);
    return input;
  }
  private applyInput(raw: MediaStream, local: MediaStream, deviceId: string, revision: number): void {
    const previous = this.rawInputStream;
    this.rawInputStream = raw;
    this.localStream = local;
    this.settings = { ...this.settings, inputDeviceId: deviceId };
    this.inputState.markApplied(deviceId, revision);
    if (previous && previous !== raw) previous.getTracks().forEach((track) => track.stop());
  }
  private async reconcileJoiningInput(assertLifecycle: AssertCurrentVoiceLifecycle): Promise<void> {
    await this.inputState.reconcile(
      (deviceId, revision, assertInput) => this.switchInputDeviceNow(deviceId, revision, () => {
        assertLifecycle(); assertInput();
      }),
      () => { this.settings = { ...this.settings, inputDeviceId: this.inputState.appliedDeviceId }; },
    );
  }
  leaveVoiceChannel(): Promise<void> {
    this.joinWaiter.reject(new Error('Подключение отменено.'));
    this.preemptOwnedMedia();
    this.inputState.joining = false;
    this.inputState.reject(new Error('Подключение отменено.'));
    this.settings = { ...this.settings, inputDeviceId: this.inputState.appliedDeviceId };
    return this.lifecycle.cancelAndRun(() => this.leaveVoiceChannelNow(true));
  }
  private async leaveVoiceChannelNow(resetState: boolean): Promise<void> {
    const channelId = this.currentChannelId;
    if (channelId !== null) unifiedWebSocketService.leaveVoiceChannel(channelId);
    this.currentChannelId = null;
    await this.cleanupMedia();
    this.participants.clear();
    this.speakingUsers.clear();
    if (resetState) { this.isMuted = false; this.isDeafened = false; }
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
    const revision = this.inputState.request(deviceId);
    if (this.inputState.joining) return this.inputState.waitFor(revision);
    if (!this.transport) {
      this.settings = { ...this.settings, inputDeviceId: deviceId };
      this.inputState.markApplied(deviceId, revision);
      return;
    }
    try {
      await this.lifecycle.runLatest((assertLifecycle) => this.switchInputDeviceNow(
        deviceId,
        revision,
        () => { assertLifecycle(); this.inputState.assertCurrent(revision); },
      ));
    } catch (error) {
      if (this.inputState.isCurrent(revision)) {
        this.inputState.rollback();
        this.settings = { ...this.settings, inputDeviceId: this.inputState.appliedDeviceId };
      }
      throw error;
    }
  }
  private async switchInputDeviceNow(deviceId: string, revision: number, assertCurrent: AssertCurrentVoiceLifecycle): Promise<void> {
    assertCurrent(); if (!this.transport) return;
    const transport = this.transport;
    await switchGroupVoiceInput({
      deviceId, transport, getMuted: () => this.isMuted, getSettings: () => this.settings,
      assertCurrent, isTransportCurrent: () => this.transport === transport,
      onBridgeApplied: (raw, appliedId) => this.applyInput(raw, raw, appliedId, revision),
      onProcessedApplied: (processed) => { this.localStream = processed; },
    });
    this.inputState.resolve(revision);
  }
  async setOutputDevice(deviceId: string): Promise<void> {
    this.settings = { ...this.settings, outputDeviceId: deviceId };
    this.outputDeviceWarning = null;
    await this.outputSwitch.apply({
      deviceId,
      elements: [...this.audioElements.values()],
      onUnsupported: () => {
        this.outputDeviceWarning = 'Браузер не поддерживает выбор устройства вывода.';
      },
    });
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
    this.configureActivityGate();
    void this.applyTransmitGate();
  }
  setVADSensitivity(value: number): void {
    this.settings = { ...this.settings, vadSensitivity: value };
    this.configureActivityGate();
    audioProcessingService.updateVADThresholds(value, this.settings.autoDetectSensitivity);
  }
  setAutoDetectSensitivity(enabled: boolean): void {
    this.settings = { ...this.settings, autoDetectSensitivity: enabled };
    this.configureActivityGate();
    audioProcessingService.updateVADThresholds(this.settings.vadSensitivity, enabled);
  }

  setPTTKey(key: string): void { this.settings = { ...this.settings, pttKey: key }; }
  setPTTDelay(delay: number): void { this.settings = { ...this.settings, pttDelay: clamp(delay, 0, 2000) }; }

  async applySettings(settings: VoiceSettingsSnapshot): Promise<void> {
    const inputPending = this.inputState.desiredDeviceId !== this.inputState.appliedDeviceId;
    const deviceChanged = !inputPending && settings.inputDeviceId !== this.inputState.appliedDeviceId;
    this.settings = { ...settings, inputDeviceId: this.inputState.appliedDeviceId };
    audioProcessingService.updateConfig(buildGroupVoiceProcessingConfig(this.settings));
    this.setInputVolume(settings.inputVolume);
    this.setOutputVolume(settings.outputVolume);
    audioProcessingService.updateVADThresholds(settings.vadSensitivity, settings.autoDetectSensitivity);
    if (deviceChanged) await this.switchInputDevice(settings.inputDeviceId);
    await this.setOutputDevice(settings.outputDeviceId);
    await this.applyTransmitGate();
  }

  async startScreenShare(options: StartScreenShareOptions = {}): Promise<boolean> {
    this.lastScreenShareStartCancelled = false;
    const transport = this.transport;
    const channelId = this.currentChannelId;
    if (!transport || channelId === null || this.isScreenSharing) return false;
    const result = await this.screenLifecycle.start({
      options, transport,
      isCurrent: () => this.transport === transport && this.currentChannelId === channelId,
    });
    this.lastScreenShareStartCancelled = result.cancelled;
    if (!result.stream) return false;
    const stream = result.stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (this.screenStream === stream) this.stopScreenShare();
    }, { once: true });
    this.screenStream = stream;
    this.isScreenSharing = true;
    const user = useAuthStore.getState().user;
    if (user) {
      attachScreenMedia(this.screenTracks, user.id, stream);
      this.updateScreenShareState(user.id, true, user);
    }
    unifiedWebSocketService.startScreenShare(channelId);
    playScreenShareSound('start');
    return true;
  }
  stopScreenShare(): void { this.screenLifecycle.invalidate(); void this.stopScreenShareNow(); }

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
  async beginMicrophoneMonitor(): Promise<MediaStream | null> {
    return this.monitor.begin({
      waitForJoin: this.activeJoinPromise,
      getTransport: () => this.transport,
      getStream: () => this.localStream,
      reconcileGate: () => this.applyTransmitGate(),
      onReady: () => { this.sendLocalSpeakingHint(); audioProcessingService.setMuted(false); },
    });
  }
  async endMicrophoneMonitor(): Promise<void> {
    await this.monitor.end(() => this.applyTransmitGate());
  }
  updateVADThresholds(value: number): void { this.setVADSensitivity(value); }
  getIsMuted(): boolean { return this.isMuted; }
  getIsDeafened(): boolean { return this.isDeafened; }
  getAppliedInputDeviceId(): string { return this.inputState.appliedDeviceId; }
  getIsSpeaking(): boolean { return this.isSpeaking; }
  getSpeakingUsers(): Set<number> { return new Set(this.speakingUsers); }
  getDiagnostics() {
    const diagnostics = audioProcessingService.getDiagnostics();
    return {
      ...diagnostics,
      unsupportedConstraints: this.outputDeviceWarning ? [...diagnostics.unsupportedConstraints, 'setSinkId'] : diagnostics.unsupportedConstraints,
      outputDeviceWarning: this.outputDeviceWarning,
      vadThresholdDbfs: sensitivityToDbfs(this.settings.vadSensitivity),
      transmitGateOpen: !this.isTransmitGated(),
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
    unifiedWebSocketService.on('voice_joined', (data: VoiceJoinedPayload) => {
      if (data.channel_id === this.currentChannelId && data.protocol_version === 1) this.joinWaiter.resolve(data);
    });
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
    unifiedWebSocketService.onUserMuted((data) => this.callbacks.participantStatusChanged?.(data.user_id, { is_muted: data.is_muted, server_muted: data.server_muted }));
    unifiedWebSocketService.onUserDeafened((data) => this.callbacks.participantStatusChanged?.(data.user_id, { is_deafened: data.is_deafened, server_deafened: data.server_deafened }));
    unifiedWebSocketService.onUserSpeaking((data) => this.setRemoteSpeaking(data.user_id, data.is_speaking));
    unifiedWebSocketService.onScreenShareStarted((data) => this.updateScreenShareState(data.user_id, true, data));
    unifiedWebSocketService.onScreenShareStopped((data) => {
      this.updateScreenShareState(data.user_id, false, data);
      removeScreenMedia(this.screenTracks, data.user_id);
    });
    unifiedWebSocketService.on('screen_share_viewer_joined', (data: { streamer_id: number }) => {
      const localUserId = useAuthStore.getState().user?.id;
      if (this.isScreenSharing && localUserId === Number(data.streamer_id)) playScreenShareSound('join');
    });
    unifiedWebSocketService.on('error', (data: { code?: string; message?: string }) => {
      if (this.joinWaiter.isPending) this.joinWaiter.reject(new Error(data.message || 'Не удалось войти в голосовой канал.'));
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

  private applyRuntimeSettings(settings: VoiceSettingsSnapshot): void {
    this.settings = settings;
    this.configureActivityGate();
    audioProcessingService.updateVADThresholds(settings.vadSensitivity, settings.autoDetectSensitivity);
  }

  private setLocalSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking;
    this.activityGate.updateNeuralSpeech(speaking);
    if (this.currentChannelId !== null) unifiedWebSocketService.updateSpeakingStatus(this.currentChannelId, speaking);
    this.sendLocalSpeakingHint();
    this.callbacks.speakingChanged?.(null, speaking);
  }

  private sendLocalSpeakingHint(): void {
    void this.transport?.setSpeaking(this.isSpeaking && !this.isTransmitGated()).catch(() => undefined);
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
    const gated = this.isTransmitGated();
    audioProcessingService.setMuted(this.monitor.active ? false : gated);
    this.sendLocalSpeakingHint();
    await this.transport?.setMicrophoneMuted(this.isTransportGated());
  }

  private isTransportGated(): boolean { return this.isMuted || this.monitor.active || (this.settings.inputMode === 'push-to-talk' && !this.pttActive); }
  private isTransmitGated(): boolean { return this.isTransportGated() || (this.settings.inputMode === 'voice-activity' && !this.activityGate.isOpen()); }
  private configureActivityGate(): void { this.activityGate.configure({ automatic: this.settings.autoDetectSensitivity, sensitivity: this.settings.vadSensitivity }); }

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
    if (media.source.startsWith('screen-')) attachScreenMedia(this.screenTracks, media.userId, media.stream);
    this.callbacks.remoteStream?.(media.userId, this.transport?.getRemoteStream(media.userId) ?? media.stream);
    this.callbacks.remoteMedia?.(media);
  }

  private removeRemoteUser(userId: number): void {
    for (const [key, audio] of this.audioElements) {
      if (!key.startsWith(`${userId}:`)) continue;
      audio.srcObject = null;
      audio.remove();
      this.audioElements.delete(key);
    }
    removeScreenMedia(this.screenTracks, userId);
  }

  private async stopScreenShareNow(): Promise<void> {
    if (!this.isScreenSharing && !this.screenStream) return;
    const stream = this.screenStream;
    this.screenStream = null;
    this.isScreenSharing = false;
    stream?.getTracks().forEach((track) => track.stop());
    await this.transport?.stopScreenShare();
    const userId = useAuthStore.getState().user?.id;
    if (userId != null) {
      this.updateScreenShareState(userId, false);
      removeScreenMedia(this.screenTracks, userId);
    }
    if (this.currentChannelId !== null) unifiedWebSocketService.stopScreenShare(this.currentChannelId);
    playScreenShareSound('stop');
  }
  private async cleanupMedia(): Promise<void> {
    const wasScreenSharing = this.isScreenSharing;
    this.joinWaiter.reject(new Error('Подключение отменено.'));
    this.detachActiveTransport();
    if (this.isSpeaking) { this.isSpeaking = false; this.callbacks.speakingChanged?.(null, false); }
    this.activityGate.reset();
    this.rawInputStream?.getTracks().forEach((track) => track.stop());
    this.rawInputStream = null;
    this.localStream = null;
    this.screenStream?.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
    this.isScreenSharing = false;
    this.viewerJoinSentAt.clear();
    for (const userId of [...this.screenSharingUsers]) this.updateScreenShareState(userId, false);
    await audioProcessingService.destroy();
    for (const userId of [...this.screenTracks.keys()]) removeScreenMedia(this.screenTracks, userId);
    for (const userId of [...this.participants.keys()]) this.removeRemoteUser(userId);
    this.cleanupRequired = false;
    if (wasScreenSharing) playScreenShareSound('stop');
  }

  private detachActiveTransport(): void {
    const transport = this.transport;
    this.transport = null;
    this.monitor.invalidate();
    transport?.close();
  }

  private preemptOwnedMedia(): void {
    this.screenLifecycle.invalidate();
    const channelId = this.currentChannelId;
    this.cleanupRequired ||= channelId !== null || this.transport !== null
      || this.rawInputStream !== null || this.screenStream !== null;
    this.currentChannelId = null;
    if (channelId !== null) unifiedWebSocketService.leaveVoiceChannel(channelId);
    this.detachActiveTransport();
    const raw = this.rawInputStream;
    const screen = this.screenStream;
    this.rawInputStream = null;
    this.localStream = null;
    this.screenStream = null;
    raw?.getTracks().forEach((track) => track.stop());
    screen?.getTracks().forEach((track) => track.stop());
  }
}

export const groupVoiceController = new GroupVoiceController();
export default groupVoiceController;
