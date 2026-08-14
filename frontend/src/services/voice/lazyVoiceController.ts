import { createEmptyDiagnostics } from '../audioProcessingTypes';
import type { VoiceSettingsSnapshot } from '../voiceSettings';
import type { GroupVoiceController } from './GroupVoiceController';
import type { StartScreenShareOptions } from './groupVoiceScreen';
import type { VoiceCallbacks } from './types';

type Controller = GroupVoiceController;

let controller: Controller | null = null;
let controllerPromise: Promise<Controller> | null = null;

export function loadVoiceController(): Promise<Controller> {
  if (controller) return Promise.resolve(controller);
  if (!controllerPromise) {
    controllerPromise = import('./GroupVoiceController').then((module) => {
      controller = module.groupVoiceController;
      return controller;
    });
  }
  return controllerPromise;
}

class LazyVoiceController {
  private callbacks: VoiceCallbacks = {};
  private screenShareListeners = new Set<NonNullable<VoiceCallbacks['screenShareChanged']>>();
  private wiredController: Controller | null = null;

  private async ready(): Promise<Controller> {
    const instance = await loadVoiceController();
    this.wire(instance);
    return instance;
  }

  private wire(instance: Controller): void {
    if (this.wiredController === instance) return;
    this.wiredController = instance;
    instance.onParticipantJoined((participant) => this.callbacks.participantJoined?.(participant));
    instance.onParticipantLeft((userId) => this.callbacks.participantLeft?.(userId));
    instance.onSpeakingChanged((userId, speaking) => this.callbacks.speakingChanged?.(userId, speaking));
    instance.onParticipantsReceived((participants) => this.callbacks.participantsReceived?.(participants));
    instance.onSignalingJoined((participants) => this.callbacks.signalingJoined?.(participants));
    instance.onParticipantStatusChanged((userId, status) => this.callbacks.participantStatusChanged?.(userId, status));
    instance.onRemoteStream((userId, stream) => this.callbacks.remoteStream?.(userId, stream));
    instance.onScreenShareChanged((userId, sharing) => {
      this.callbacks.screenShareChanged?.(userId, sharing);
      this.screenShareListeners.forEach((listener) => listener(userId, sharing));
    });
  }

  joinVoiceChannel(channelId: number): Promise<void> {
    return this.ready().then((instance) => instance.joinVoiceChannel(channelId));
  }

  leaveVoiceChannel(): void {
    void this.ready().then((instance) => instance.leaveVoiceChannel());
  }

  setMuted(muted: boolean): Promise<void> {
    return this.ready().then((instance) => instance.setMuted(muted));
  }

  setDeafened(deafened: boolean): Promise<void> {
    return this.ready().then((instance) => instance.setDeafened(deafened));
  }

  toggleMute(): void {
    void this.ready().then((instance) => instance.toggleMute());
  }

  toggleDeafen(): void {
    void this.ready().then((instance) => instance.toggleDeafen());
  }

  switchInputDevice(deviceId: string): Promise<void> {
    return this.ready().then((instance) => instance.switchInputDevice(deviceId));
  }

  setOutputDevice(deviceId: string): Promise<void> {
    return this.ready().then((instance) => instance.setOutputDevice(deviceId));
  }

  setParticipantVolume(userId: number, value: number): void {
    void this.ready().then((instance) => instance.setParticipantVolume(userId, value));
  }

  setInputVolume(value: number): void {
    void this.ready().then((instance) => instance.setInputVolume(value));
  }

  setOutputVolume(value: number): void {
    void this.ready().then((instance) => instance.setOutputVolume(value));
  }

  setInputMode(mode: 'voice-activity' | 'push-to-talk'): void {
    void this.ready().then((instance) => instance.setInputMode(mode));
  }

  setVADSensitivity(value: number): void {
    void this.ready().then((instance) => instance.setVADSensitivity(value));
  }

  updateVADThresholds(value: number): void {
    void this.ready().then((instance) => instance.updateVADThresholds(value));
  }

  setAutoDetectSensitivity(enabled: boolean): void {
    void this.ready().then((instance) => instance.setAutoDetectSensitivity(enabled));
  }

  setPTTKey(key: string): void {
    void this.ready().then((instance) => instance.setPTTKey(key));
  }

  setPTTDelay(delay: number): void {
    void this.ready().then((instance) => instance.setPTTDelay(delay));
  }

  applySettings(settings: VoiceSettingsSnapshot): Promise<void> {
    return this.ready().then((instance) => instance.applySettings(settings));
  }

  startScreenShare(options: StartScreenShareOptions = {}): Promise<boolean> {
    return this.ready().then((instance) => instance.startScreenShare(options));
  }

  playSoundboard(track: MediaStreamTrack, ticket: string): Promise<() => Promise<void>> {
    return this.ready().then((instance) => instance.playSoundboard(track, ticket));
  }

  stopScreenShare(): void {
    void this.ready().then((instance) => instance.stopScreenShare());
  }

  ensureRemoteScreenShare(userId: number): Promise<void> {
    return this.ready().then((instance) => instance.ensureRemoteScreenShare(userId));
  }

  notifyStreamerViewerJoined(userId: number): void {
    void this.ready().then((instance) => instance.notifyStreamerViewerJoined(userId));
  }

  reapplyScreenShareQuality(): Promise<void> {
    return this.ready().then((instance) => instance.reapplyScreenShareQuality());
  }

  getScreenSharingStatus(): boolean {
    return controller?.getScreenSharingStatus() ?? false;
  }

  wasLastScreenShareStartCancelled(): boolean {
    return controller?.wasLastScreenShareStartCancelled() ?? false;
  }

  getStreamQualityLabel(): string {
    return controller?.getStreamQualityLabel() ?? 'Авто';
  }

  getCurrentVolume(): number {
    return controller?.getCurrentVolume() ?? 0;
  }

  getIsMuted(): boolean {
    return controller?.getIsMuted() ?? false;
  }

  getIsDeafened(): boolean {
    return controller?.getIsDeafened() ?? false;
  }

  getAppliedInputDeviceId(): string {
    return controller?.getAppliedInputDeviceId() ?? '';
  }

  getIsSpeaking(): boolean {
    return controller?.getIsSpeaking() ?? false;
  }

  getSpeakingUsers(): Set<number> {
    return controller?.getSpeakingUsers() ?? new Set<number>();
  }

  getDiagnostics() {
    return controller?.getDiagnostics() ?? {
      ...createEmptyDiagnostics(),
      outputDeviceWarning: null,
      vadThresholdDbfs: -50,
      transmitGateOpen: false,
    };
  }

  beginMicrophoneMonitor(): Promise<MediaStream | null> {
    return this.ready().then((instance) => instance.beginMicrophoneMonitor());
  }

  endMicrophoneMonitor(): Promise<void> {
    return this.ready().then((instance) => instance.endMicrophoneMonitor());
  }

  onParticipantJoined(callback: NonNullable<VoiceCallbacks['participantJoined']>): void {
    this.callbacks.participantJoined = callback;
  }

  onParticipantLeft(callback: NonNullable<VoiceCallbacks['participantLeft']>): void {
    this.callbacks.participantLeft = callback;
  }

  onSpeakingChanged(callback: NonNullable<VoiceCallbacks['speakingChanged']>): void {
    this.callbacks.speakingChanged = callback;
  }

  onParticipantsReceived(callback: NonNullable<VoiceCallbacks['participantsReceived']>): void {
    this.callbacks.participantsReceived = callback;
  }

  onSignalingJoined(callback: NonNullable<VoiceCallbacks['signalingJoined']>): void {
    this.callbacks.signalingJoined = callback;
  }

  onParticipantStatusChanged(callback: NonNullable<VoiceCallbacks['participantStatusChanged']>): void {
    this.callbacks.participantStatusChanged = callback;
  }

  onScreenShareChanged(callback: NonNullable<VoiceCallbacks['screenShareChanged']>): void {
    this.callbacks.screenShareChanged = callback;
  }

  onScreenShareChange(callback: NonNullable<VoiceCallbacks['screenShareChanged']>): () => void {
    this.screenShareListeners.add(callback);
    return () => this.screenShareListeners.delete(callback);
  }

  onRemoteStream(callback: NonNullable<VoiceCallbacks['remoteStream']>): void {
    this.callbacks.remoteStream = callback;
  }
}

export const lazyVoiceController = new LazyVoiceController();
export default lazyVoiceController;
