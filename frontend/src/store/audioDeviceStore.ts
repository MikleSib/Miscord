import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AudioDeviceState {
  inputDeviceId: string;
  outputDeviceId: string;
  inputVolume: number;
  outputVolume: number;
  setInputDeviceId: (inputDeviceId: string) => void;
  setOutputDeviceId: (outputDeviceId: string) => void;
  setInputVolume: (inputVolume: number) => void;
  setOutputVolume: (outputVolume: number) => void;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export const useAudioDeviceStore = create<AudioDeviceState>()(
  persist(
    (set) => ({
      inputDeviceId: 'default',
      outputDeviceId: 'default',
      inputVolume: 100,
      outputVolume: 100,
      setInputDeviceId: (inputDeviceId) => set({ inputDeviceId }),
      setOutputDeviceId: (outputDeviceId) => set({ outputDeviceId }),
      setInputVolume: (inputVolume) => set({ inputVolume: clampPercent(inputVolume) }),
      setOutputVolume: (outputVolume) => set({ outputVolume: clampPercent(outputVolume) }),
    }),
    {
      name: 'miscord-audio-devices',
      version: 2,
      migrate: (persisted: unknown) => {
        const state = (persisted || {}) as Partial<AudioDeviceState>;
        return {
          inputDeviceId: state.inputDeviceId || 'default',
          outputDeviceId: state.outputDeviceId || 'default',
          // Старые тихие значения поднимаем до нормальных 100%
          inputVolume: typeof state.inputVolume === 'number' && state.inputVolume > 0
            ? Math.max(state.inputVolume, 100)
            : 100,
          outputVolume: typeof state.outputVolume === 'number' && state.outputVolume > 0
            ? Math.max(state.outputVolume, 100)
            : 100,
        };
      },
    }
  )
);
