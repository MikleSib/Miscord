import { useCallback, useEffect, useState } from 'react';
import {
  createAudioDevicePreference,
  resolveAudioDevicePreference,
} from '../services/audioDevicePreference';
import { useAudioDeviceStore } from '../store/audioDeviceStore';
import voiceSettingsController from '../services/voiceSettingsController';

const samePreference = (
  current: ReturnType<typeof createAudioDevicePreference>,
  next: ReturnType<typeof createAudioDevicePreference>,
) => current?.deviceId === next?.deviceId
  && current?.groupId === next?.groupId
  && current?.label === next?.label;

export const useVoiceAudioDevices = (isOpen: boolean) => {
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const selectedInputDeviceId = useAudioDeviceStore((state) => state.inputDeviceId);
  const selectedOutputDeviceId = useAudioDeviceStore((state) => state.outputDeviceId);
  const inputVolume = useAudioDeviceStore((state) => state.inputVolume);
  const outputVolume = useAudioDeviceStore((state) => state.outputVolume);

  const loadDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    const outputs = devices.filter((device) => device.kind === 'audiooutput');
    setInputDevices(inputs);
    setOutputDevices(outputs);

    const store = useAudioDeviceStore.getState();
    const input = resolveAudioDevicePreference(
      store.inputDeviceId,
      store.inputDevicePreference,
      inputs,
    );
    const inputPreference = createAudioDevicePreference(
      input?.deviceId ?? store.inputDeviceId,
      input ?? undefined,
    );
    let inputReady = true;
    if (input && input.deviceId !== store.inputDeviceId) {
      try {
        await voiceSettingsController.setInputDevice(input.deviceId);
      } catch {
        inputReady = false;
      }
    }
    if (input && inputReady && !samePreference(
      useAudioDeviceStore.getState().inputDevicePreference,
      inputPreference,
    )) {
      store.rememberInputDevice(inputPreference);
    }

    const output = resolveAudioDevicePreference(
      store.outputDeviceId,
      store.outputDevicePreference,
      outputs,
    );
    const outputPreference = createAudioDevicePreference(
      output?.deviceId ?? store.outputDeviceId,
      output ?? undefined,
    );
    let outputReady = true;
    if (output && output.deviceId !== store.outputDeviceId) {
      try {
        await voiceSettingsController.setOutputDevice(output.deviceId);
      } catch {
        outputReady = false;
      }
    }
    if (output && outputReady && !samePreference(
      useAudioDeviceStore.getState().outputDevicePreference,
      outputPreference,
    )) {
      store.rememberOutputDevice(outputPreference);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadDevices();
    const onDeviceChange = () => void loadDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener?.(
      'devicechange',
      onDeviceChange,
    );
  }, [isOpen, loadDevices]);

  const rememberInput = useCallback((deviceId: string) => {
    const device = inputDevices.find((item) => item.deviceId === deviceId);
    useAudioDeviceStore.getState().rememberInputDevice(
      createAudioDevicePreference(deviceId, device),
    );
  }, [inputDevices]);

  const rememberOutput = useCallback((deviceId: string) => {
    const device = outputDevices.find((item) => item.deviceId === deviceId);
    useAudioDeviceStore.getState().rememberOutputDevice(
      createAudioDevicePreference(deviceId, device),
    );
  }, [outputDevices]);

  return {
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    inputVolume,
    outputVolume,
    loadDevices,
    rememberInput,
    rememberOutput,
  };
};
