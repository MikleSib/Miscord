import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NoiseSuppressionEngine = 'miscord-ai' | 'deepfilternet3' | 'browser';
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
      // v4: Miscord AI всегда дефолт для новых / после миграции без engine
      version: 4,
      partialize: (state) => ({
        enabled: state.enabled,
        engine: state.engine,
        autoFallback: state.autoFallback,
      }),
      migrate: (persistedState: any) => {
        const engine =
          persistedState?.engine === 'gtcrn'
            ? 'deepfilternet3'
            : persistedState?.engine === 'browser' ||
                persistedState?.engine === 'deepfilternet3' ||
                persistedState?.engine === 'miscord-ai'
              ? persistedState.engine
              : 'miscord-ai'

        return {
          ...persistedState,
          // Если настройки ещё не задавались — включаем Miscord AI
          enabled: typeof persistedState?.enabled === 'boolean' ? persistedState.enabled : true,
          engine,
          autoFallback:
            typeof persistedState?.autoFallback === 'boolean'
              ? persistedState.autoFallback
              : true,
        }
      },
    }
  )
);
