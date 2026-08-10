import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MAX_INPUT_VOLUME_PERCENT } from '../services/voiceSettingsLogic';
import type { AudioDevicePreference } from '../services/audioDevicePreference';

interface AudioDeviceState {
  inputDeviceId: string;
  outputDeviceId: string;
  inputDevicePreference: AudioDevicePreference | null;
  outputDevicePreference: AudioDevicePreference | null;
  inputVolume: number;
  outputVolume: number;
  setInputDeviceId: (inputDeviceId: string) => void;
  setOutputDeviceId: (outputDeviceId: string) => void;
  rememberInputDevice: (preference: AudioDevicePreference | null) => void;
  rememberOutputDevice: (preference: AudioDevicePreference | null) => void;
  setInputVolume: (inputVolume: number) => void;
  setOutputVolume: (outputVolume: number) => void;
}

const clampPercent = (value: number, max = 100) =>
  Math.min(max, Math.max(0, Math.round(value)));
// Вход умеет усиливать выше исходного уровня, выход — только громкость <audio>.
const clampInput = (value: number) => clampPercent(value, MAX_INPUT_VOLUME_PERCENT);

const preferenceForId = (
  current: AudioDevicePreference | null,
  deviceId: string,
): AudioDevicePreference | null => {
  if (deviceId === 'default') return null;
  return current?.deviceId === deviceId
    ? current
    : { deviceId, groupId: '', label: '' };
};

export const useAudioDeviceStore = create<AudioDeviceState>()(
  persist(
    (set) => ({
      inputDeviceId: 'default',
      outputDeviceId: 'default',
      inputDevicePreference: null,
      outputDevicePreference: null,
      inputVolume: 100,
      outputVolume: 100,
      setInputDeviceId: (inputDeviceId) => set((state) => ({
        inputDeviceId,
        inputDevicePreference: preferenceForId(
          state.inputDevicePreference,
          inputDeviceId,
        ),
      })),
      setOutputDeviceId: (outputDeviceId) => set((state) => ({
        outputDeviceId,
        outputDevicePreference: preferenceForId(
          state.outputDevicePreference,
          outputDeviceId,
        ),
      })),
      rememberInputDevice: (preference) => set({
        inputDeviceId: preference?.deviceId ?? 'default',
        inputDevicePreference: preference,
      }),
      rememberOutputDevice: (preference) => set({
        outputDeviceId: preference?.deviceId ?? 'default',
        outputDevicePreference: preference,
      }),
      setInputVolume: (inputVolume) => set({ inputVolume: clampInput(inputVolume) }),
      setOutputVolume: (outputVolume) => set({ outputVolume: clampPercent(outputVolume) }),
    }),
    {
      name: 'miscord-audio-devices',
      version: 3,
      migrate: (persisted: unknown) => {
        const state = (persisted || {}) as Partial<AudioDeviceState>;
        const inputDeviceId = state.inputDeviceId || 'default';
        const outputDeviceId = state.outputDeviceId || 'default';
        return {
          inputDeviceId,
          outputDeviceId,
          inputDevicePreference: state.inputDevicePreference
            ?? preferenceForId(null, inputDeviceId),
          outputDevicePreference: state.outputDevicePreference
            ?? preferenceForId(null, outputDeviceId),
          // Старые тихие значения поднимаем до нормальных 100%
          inputVolume: typeof state.inputVolume === 'number' && state.inputVolume > 0
            ? clampInput(Math.max(state.inputVolume, 100))
            : 100,
          outputVolume: typeof state.outputVolume === 'number' && state.outputVolume > 0
            ? Math.max(state.outputVolume, 100)
            : 100,
        };
      },
      partialize: (state) => ({
        inputDeviceId: state.inputDeviceId,
        outputDeviceId: state.outputDeviceId,
        inputDevicePreference: state.inputDevicePreference,
        outputDevicePreference: state.outputDevicePreference,
        inputVolume: state.inputVolume,
        outputVolume: state.outputVolume,
      }),
    }
  )
);
