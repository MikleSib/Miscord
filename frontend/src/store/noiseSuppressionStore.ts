import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NoiseSuppressionEngine = 'miscord-ai' | 'browser';
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
      engine: 'miscord-ai',
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
      version: 1,
      partialize: (state) => ({
        enabled: state.enabled,
        engine: state.engine,
        autoFallback: state.autoFallback,
      }),
      migrate: (persistedState: any) => ({
        ...persistedState,
        engine:
          persistedState?.engine === 'browser'
            ? 'browser'
            : 'miscord-ai',
      }),
    }
  )
);
