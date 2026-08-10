import { audioProcessingService } from '../audioProcessingService';
import { captureAudioStream, type VoiceSettingsSnapshot } from '../voiceSettings';
import { buildGroupVoiceProcessingConfig } from './groupVoiceProcessing';
import type { SfuTransport } from './sfuTransport';
import type { AssertCurrentVoiceLifecycle } from './voiceLifecycle';

const stopStream = (stream: MediaStream): void => {
  stream.getTracks().forEach((track) => track.stop());
};

const capturedDeviceId = (stream: MediaStream, requested: string): string => {
  if (requested === 'default') return 'default';
  return stream.getAudioTracks()[0]?.getSettings?.().deviceId || 'default';
};

export interface PreparedGroupVoiceInput {
  raw: MediaStream;
  processed: MediaStream;
  track: MediaStreamTrack;
  revision: number;
  deviceId: string;
}

interface PrepareInputOptions {
  getSettings: () => VoiceSettingsSnapshot;
  getRevision: () => number;
  assertLifecycleCurrent: AssertCurrentVoiceLifecycle;
  onApplied: (input: PreparedGroupVoiceInput) => void;
}

export async function prepareGroupVoiceInput(
  options: PrepareInputOptions,
): Promise<PreparedGroupVoiceInput> {
  for (;;) {
    const revision = options.getRevision();
    const requested = options.getSettings();
    let raw: MediaStream;
    try {
      raw = await captureAudioStream(requested.processing, requested.inputDeviceId);
    } catch (error) {
      options.assertLifecycleCurrent();
      if (revision !== options.getRevision()) continue;
      throw error;
    }
    let owned = false;
    try {
      options.assertLifecycleCurrent();
      if (revision !== options.getRevision()) continue;
      const latest = options.getSettings();
      const processed = await audioProcessingService.initialize(
        raw,
        buildGroupVoiceProcessingConfig({ ...latest, inputDeviceId: requested.inputDeviceId }),
      );
      options.assertLifecycleCurrent();
      if (revision !== options.getRevision()) continue;
      const track = processed.getAudioTracks()[0];
      if (!track) throw new Error('Новое устройство не создало аудиодорожку.');
      const input = {
        raw, processed, track, revision,
        deviceId: capturedDeviceId(raw, requested.inputDeviceId),
      };
      options.onApplied(input);
      owned = true;
      audioProcessingService.updateConfig(buildGroupVoiceProcessingConfig(options.getSettings()));
      return input;
    } finally {
      if (!owned) stopStream(raw);
    }
  }
}

interface SwitchInputOptions {
  deviceId: string;
  transport: SfuTransport;
  getMuted: () => boolean;
  getSettings: () => VoiceSettingsSnapshot;
  assertCurrent: AssertCurrentVoiceLifecycle;
  isTransportCurrent: () => boolean;
  onBridgeApplied: (raw: MediaStream, deviceId: string) => void;
  onProcessedApplied: (processed: MediaStream) => void;
}

export async function switchGroupVoiceInput(options: SwitchInputOptions): Promise<void> {
  const captureSettings = options.getSettings();
  const nextRaw = await captureAudioStream(
    captureSettings.processing,
    options.deviceId,
    { strictDevice: true },
  );
  let bridged = false;
  try {
    const reportedDeviceId = nextRaw.getAudioTracks()[0]?.getSettings?.().deviceId;
    if (options.deviceId !== 'default' && reportedDeviceId && reportedDeviceId !== options.deviceId) {
      throw new Error('Браузер открыл другой микрофон вместо выбранного.');
    }
    options.assertCurrent();
    if (!options.isTransportCurrent()) throw new Error('Voice transport changed during microphone switch');
    const rawTrack = nextRaw.getAudioTracks()[0];
    if (!rawTrack) throw new Error('Новое устройство не создало аудиодорожку.');

    await options.transport.replaceMicrophoneTrack(rawTrack);
    if (!options.isTransportCurrent()) throw new Error('Voice transport changed during microphone switch');
    bridged = true;
    options.onBridgeApplied(nextRaw, options.deviceId);
    if (!options.isTransportCurrent()) throw new Error('Voice transport changed during microphone switch');

    // initialize() replaces the singleton graph. The producer already points to the
    // candidate raw track, so superseding or a later capture failure cannot silence it.
    const latest = options.getSettings();
    const processed = await audioProcessingService.initialize(
      nextRaw,
      buildGroupVoiceProcessingConfig({ ...latest, inputDeviceId: options.deviceId }),
    );
    const processedTrack = processed.getAudioTracks()[0];
    if (!processedTrack || !options.isTransportCurrent()) {
      throw new Error('Voice transport changed during microphone switch');
    }
    await options.transport.replaceMicrophoneTrack(processedTrack);
    if (!options.isTransportCurrent()) throw new Error('Voice transport changed during microphone switch');
    options.onProcessedApplied(processed);
    audioProcessingService.updateConfig(buildGroupVoiceProcessingConfig(options.getSettings()));
    audioProcessingService.setMuted(options.getMuted());
    options.assertCurrent();
  } catch (error) {
    // Once the raw bridge is installed it is the last-known-good producer input and is
    // owned by the controller. Before that point the candidate is always disposable.
    if (!bridged) stopStream(nextRaw);
    throw error;
  }
}
