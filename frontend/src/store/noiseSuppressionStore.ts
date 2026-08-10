import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  normalizeNoiseSuppressionEngine,
  type NoiseSuppressionEngine,
} from '../services/noiseSuppressionEngine';

export type { NoiseSuppressionEngine } from '../services/noiseSuppressionEngine';
export type NoiseSuppressionRuntimeStatus =
  | 'idle'
  | 'loading'
  | 'active'
  | 'fallback'
  | 'error';

interface NoiseSuppressionState {
  enabled: boolean;
  engine: NoiseSuppressionEngine;
  autoFallback: boolean;
  runtimeStatus: NoiseSuppressionRuntimeStatus;
  runtimeMessage: string | null;
  activeEngine: NoiseSuppressionEngine | null;
  setEnabled: (enabled: boolean) => void;
  setEngine: (engine: NoiseSuppressionEngine) => void;
  setAutoFallback: (autoFallback: boolean) => void;
  setRuntimeStatus: (
    runtimeStatus: NoiseSuppressionRuntimeStatus,
    runtimeMessage?: string | null,
    activeEngine?: NoiseSuppressionEngine | null
  ) => void;
}

export const useNoiseSuppressionStore = create<NoiseSuppressionState>()(
  persist(
    (set) => ({
      enabled: true,
      engine: 'deepfilternet3',
      autoFallback: true,
      runtimeStatus: 'idle',
      runtimeMessage: null,
      activeEngine: null,
      setEnabled: (enabled) => set({ enabled }),
      setEngine: (engine) => set({ engine }),
      setAutoFallback: (autoFallback) => set({ autoFallback }),
      setRuntimeStatus: (runtimeStatus, runtimeMessage = null, activeEngine = null) =>
        set({ runtimeStatus, runtimeMessage, activeEngine }),
    }),
    {
      name: 'miscord-noise-suppression',
      // v6 normalizes legacy engine identifiers without changing a valid choice.
      version: 6,
      partialize: (state) => ({
        enabled: state.enabled,
        engine: state.engine,
        autoFallback: state.autoFallback,
      }),
      migrate: (persistedState: any) => {
        return {
          ...persistedState,
          enabled: typeof persistedState?.enabled === 'boolean' ? persistedState.enabled : true,
          engine: normalizeNoiseSuppressionEngine(persistedState?.engine),
          autoFallback:
            typeof persistedState?.autoFallback === 'boolean'
              ? persistedState.autoFallback
              : true,
        };
      },
    }
  )
);
