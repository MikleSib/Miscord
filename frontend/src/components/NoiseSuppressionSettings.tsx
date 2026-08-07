import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Cpu,
  Info,
  Loader2,
  Shield,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import {
  audioProcessingService,
  NoiseSuppressionEngine,
} from '../services/audioProcessingService';
import { useNoiseSuppressionStore } from '../store/noiseSuppressionStore';
import { Switch } from './ui/switch';

interface NoiseSuppressionSettingsProps {
  currentEngine?: NoiseSuppressionEngine;
  onEngineChange?: (engine: NoiseSuppressionEngine) => void;
}

const runtimeLabels = {
  idle: 'Выключено',
  loading: 'Запускается',
  active: 'Работает',
  fallback: 'Резервный режим',
  error: 'Ошибка',
} as const;

export const NoiseSuppressionSettings: React.FC<NoiseSuppressionSettingsProps> = ({
  currentEngine,
  onEngineChange,
}) => {
  const enabled = useNoiseSuppressionStore((state) => state.enabled);
  const engine = useNoiseSuppressionStore((state) => state.engine);
  const autoFallback = useNoiseSuppressionStore((state) => state.autoFallback);
  const runtimeStatus = useNoiseSuppressionStore((state) => state.runtimeStatus);
  const runtimeMessage = useNoiseSuppressionStore((state) => state.runtimeMessage);
  const activeEngine = useNoiseSuppressionStore((state) => state.activeEngine);
  const setEnabled = useNoiseSuppressionStore((state) => state.setEnabled);
  const setEngine = useNoiseSuppressionStore((state) => state.setEngine);
  const setAutoFallback = useNoiseSuppressionStore((state) => state.setAutoFallback);
  const [isApplying, setIsApplying] = useState(false);
  const [supportedEngines, setSupportedEngines] = useState<
    ReturnType<typeof audioProcessingService.getSupportedEngines>
  >([
    {
      engine: 'miscord-ai',
      supported: false,
      name: 'Miscord AI',
    },
    {
      engine: 'deepfilternet3',
      supported: false,
      name: 'DeepFilterNet3',
    },
    {
      engine: 'browser',
      supported: true,
      name: 'Стандартное',
    },
  ]);

  useEffect(() => {
    setSupportedEngines(audioProcessingService.getSupportedEngines());
  }, []);

  useEffect(() => {
    if (currentEngine && currentEngine !== engine) {
      setEngine(currentEngine);
    }
  }, [currentEngine, engine, setEngine]);

  const selectedEngineSupported = useMemo(
    () => supportedEngines.find((item) => item.engine === engine)?.supported ?? true,
    [engine, supportedEngines]
  );

  const apply = async (nextEnabled: boolean, nextEngine: NoiseSuppressionEngine) => {
    setIsApplying(true);
    try {
      await audioProcessingService.setNoiseSuppression(nextEnabled, nextEngine);
    } finally {
      setIsApplying(false);
    }
  };

  const handleEnabledChange = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    void apply(nextEnabled, engine);
  };

  const handleEngineChange = (nextEngine: NoiseSuppressionEngine) => {
    const supported = supportedEngines.find((item) => item.engine === nextEngine)?.supported;
    if (supported === false) return;

    setEngine(nextEngine);
    onEngineChange?.(nextEngine);
    if (enabled) void apply(true, nextEngine);
  };

  const statusTone =
    runtimeStatus === 'fallback' || runtimeStatus === 'error'
      ? 'border-amber-400/25 bg-amber-400/10 text-amber-200'
      : runtimeStatus === 'active'
        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
        : 'border-border bg-background/50 text-muted-foreground';

  return (
    <section className="rounded-xl border border-border bg-secondary/70 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-400">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Шумоподавление</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Убирает клавиатуру, вентилятор и фоновый гул до отправки голоса в канал.
            </p>
          </div>
        </div>
        <Switch
          className="mt-1"
          checked={enabled}
          aria-label="Включить шумоподавление"
          disabled={isApplying || !selectedEngineSupported}
          onCheckedChange={handleEnabledChange}
        />
      </div>

      <div className="mt-5 space-y-2">
        {supportedEngines.map(({ engine: itemEngine, supported, name }) => {
          const isSelected = engine === itemEngine;
          const isMiscordAI = itemEngine === 'miscord-ai';
          const isDeepFilterNet3 = itemEngine === 'deepfilternet3';
          const isNeural = isMiscordAI || isDeepFilterNet3;

          return (
            <button
              key={itemEngine}
              type="button"
              onClick={() => handleEngineChange(itemEngine)}
              disabled={!supported || isApplying}
              aria-pressed={isSelected}
              className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                isSelected
                  ? 'border-emerald-400/40 bg-emerald-400/[0.07]'
                  : 'border-border bg-background/45 hover:border-border/80 hover:bg-background/70'
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span
                className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md ${
                  isSelected ? 'bg-emerald-400/15 text-emerald-300' : 'bg-muted text-muted-foreground'
                }`}
              >
                {isNeural ? <Sparkles className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{name}</span>
                  {isMiscordAI && (
                    <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                      Рекомендуется
                    </span>
                  )}
                  {isDeepFilterNet3 && (
                    <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                      Тестовый
                    </span>
                  )}
                  {!supported && (
                    <span className="text-xs text-amber-300">Не поддерживается</span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {isMiscordAI
                    ? 'Локальная нейросеть RNNoise отделяет речь от постоянного и импульсного шума.'
                    : isDeepFilterNet3
                      ? 'Локальный DeepFilterNet3 C/WASM. Тестовое подавление сложного фонового шума.'
                      : 'Встроенная обработка WebRTC с минимальной нагрузкой на систему.'}
                </span>
                <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{isMiscordAI ? 'AI — 48 кГц' : isDeepFilterNet3 ? 'DeepFilterNet3 — 48 кГц' : 'WebRTC'}</span>
                  <span>{isMiscordAI ? 'Нагрузка: средняя' : isDeepFilterNet3 ? 'Нагрузка: высокая' : 'Нагрузка: низкая'}</span>
                  <span>{isNeural ? 'Обработка: локально' : 'Обработка: браузер'}</span>
                </span>
              </span>
              <span
                className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  isSelected
                    ? 'border-emerald-400 bg-emerald-400 text-[#101713]'
                    : 'border-muted-foreground/40'
                }`}
                aria-hidden="true"
              >
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          );
        })}
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background/35 px-3.5 py-3">
        <input
          type="checkbox"
          checked={autoFallback}
          onChange={(event) => setAutoFallback(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-emerald-500"
        />
        <span>
          <span className="block text-sm font-medium text-foreground">Автоматический резервный режим</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            Переключаться на WebRTC при перегрузке системы или ошибке AI-процессора.
          </span>
        </span>
      </label>

      {(runtimeStatus !== 'idle' || runtimeMessage) && (
        <div className={`mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-xs ${statusTone}`}>
          {runtimeStatus === 'loading' || isApplying ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          ) : runtimeStatus === 'fallback' || runtimeStatus === 'error' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div>
            <span className="font-semibold">{runtimeLabels[runtimeStatus]}</span>
            {activeEngine === 'browser' && engine !== 'browser' && ' · WebRTC'}
            {runtimeMessage && <p className="mt-0.5 leading-relaxed opacity-85">{runtimeMessage}</p>}
          </div>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Аудио обрабатывается на вашем устройстве и не отправляется внешнему AI-сервису.
      </p>
    </section>
  );
};
