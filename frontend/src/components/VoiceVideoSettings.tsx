import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Headphones, Mic } from 'lucide-react';
import {
  useNoiseSuppressionStore,
  type NoiseSuppressionEngine,
} from '../store/noiseSuppressionStore';
import { useVADSettingsStore } from '../store/vadSettingsStore';
import { useVoiceProcessingSettingsStore } from '../store/voiceProcessingSettingsStore';
import {
  getEffectiveProcessingSettings,
  MAX_INPUT_VOLUME_PERCENT,
  type VoiceProcessingProfile,
  type VoiceProcessingSettings,
} from '../services/voiceSettings';
import voiceSettingsController from '../services/voiceSettingsController';
import optimizedVoiceService from '../services/optimizedVoiceService';
import { audioProcessingService } from '../services/audioProcessingService';
import type { NoiseSuppressionRuntimeStatus } from '../store/noiseSuppressionStore';
import { MicTestSession } from '../services/micTestService';
import {
  restoreCallAfterMicTest,
  suspendCallForMicTest,
  type SavedMicTestCallState,
} from '../services/micTestCallState';
import { cn } from '../lib/utils';
import {
  DeviceSelect,
  Divider,
  LabeledSlider,
  SensitivitySlider,
  SettingSwitch,
} from './VoiceSettingsControls';
import {
  ENGINE_LABELS,
  PROFILE_COPY,
  statusLabel,
} from './voiceSettingsPresentation';
import { useVoiceAudioDevices } from './useVoiceAudioDevices';
import { VoiceSoundSettings } from './settings/VoiceSoundSettings';

interface VoiceVideoSettingsProps {
  isOpen?: boolean;
}

const VoiceVideoSettings: React.FC<VoiceVideoSettingsProps> = ({
  isOpen = true,
}) => {
  const {
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    inputVolume,
    outputVolume,
    loadDevices,
    rememberInput,
    rememberOutput,
  } = useVoiceAudioDevices(isOpen);

  const profile = useVoiceProcessingSettingsStore((state) => state.profile);
  const customSettings = useVoiceProcessingSettingsStore(
    (state) => state.customSettings,
  );
  const inputMode = useVADSettingsStore((state) => state.inputMode);
  const vadSensitivity = useVADSettingsStore(
    (state) => state.vadSensitivity,
  );
  const autoDetectSensitivity = useVADSettingsStore(
    (state) => state.autoDetectSensitivity,
  );
  const pttKey = useVADSettingsStore((state) => state.pttKey);
  const pttDelay = useVADSettingsStore((state) => state.pttDelay);
  const runtimeStatus = useNoiseSuppressionStore(
    (state) => state.runtimeStatus,
  );
  const runtimeMessage = useNoiseSuppressionStore(
    (state) => state.runtimeMessage,
  );
  const activeRuntimeEngine = useNoiseSuppressionStore(
    (state) => state.engine,
  );

  const [isTesting, setIsTesting] = useState(false);
  const [testLevel, setTestLevel] = useState(0);
  const [testGateOpen, setTestGateOpen] = useState(false);
  const [callLevel, setCallLevel] = useState(0);
  const [testError, setTestError] = useState<string | null>(null);
  const [testRuntime, setTestRuntime] = useState<{
    status: NoiseSuppressionRuntimeStatus;
    message: string | null;
    engine: string | null;
  } | null>(null);
  const [isRecordingPTT, setIsRecordingPTT] = useState(false);
  const micTestRef = useRef(new MicTestSession());
  const callStateBeforeTestRef = useRef<SavedMicTestCallState | null>(null);

  const effectiveProcessing = useMemo(
    () => getEffectiveProcessingSettings(profile, customSettings),
    [profile, customSettings],
  );
  const supportedEngines = useMemo(
    () =>
      new Set(
        audioProcessingService
          .getSupportedEngines()
          .filter((item) => item.supported)
          .map((item) => item.engine),
      ),
    [],
  );

  const suspendCallForTest = useCallback(() => {
    if (callStateBeforeTestRef.current) return;
    callStateBeforeTestRef.current = suspendCallForMicTest();
  }, []);

  const restoreCallAfterTest = useCallback(() => {
    const saved = callStateBeforeTestRef.current;
    callStateBeforeTestRef.current = null;
    restoreCallAfterMicTest(saved);
  }, []);

  const runMicTest = useCallback(async () => {
    const snapshot = voiceSettingsController.getSnapshot();
    setTestError(null);
    setTestRuntime({ status: 'loading', message: null, engine: null });

    await micTestRef.current.start({
      inputDeviceId: snapshot.inputDeviceId,
      outputDeviceId: snapshot.outputDeviceId,
      inputVolume: snapshot.inputVolume,
      outputVolume: snapshot.outputVolume,
      processing: snapshot.processing,
      inputMode: snapshot.inputMode,
      vadSensitivity: snapshot.vadSensitivity,
      autoDetectSensitivity: snapshot.autoDetectSensitivity,
      onLevel: setTestLevel,
      onGateChange: setTestGateOpen,
      onRuntimeStatus: (status, message, engine) =>
        setTestRuntime({ status, message, engine }),
    });
    await loadDevices();
  }, [loadDevices]);

  const startMicTest = useCallback(async () => {
    suspendCallForTest();
    setIsTesting(true);
    try {
      await runMicTest();
    } catch (error) {
      setIsTesting(false);
      setTestLevel(0);
      setTestError(
        error instanceof Error
          ? error.message
          : 'Не удалось запустить проверку микрофона',
      );
      restoreCallAfterTest();
    }
  }, [restoreCallAfterTest, runMicTest, suspendCallForTest]);

  const stopMicTest = useCallback(() => {
    micTestRef.current.stop();
    setIsTesting(false);
    setTestLevel(0);
    setTestGateOpen(false);
    setTestRuntime(null);
    restoreCallAfterTest();
  }, [restoreCallAfterTest]);

  const restartMicTest = useCallback(async () => {
    if (!isTesting) return;
    try {
      await runMicTest();
    } catch (error) {
      setTestError(
        error instanceof Error
          ? error.message
          : 'Не удалось применить настройки к проверке',
      );
      stopMicTest();
    }
  }, [isTesting, runMicTest, stopMicTest]);

  const setInputMode = (mode: 'voice-activity' | 'push-to-talk') => {
    voiceSettingsController.setInputMode(mode);
    micTestRef.current.updateGateSettings(
      mode,
      autoDetectSensitivity,
      vadSensitivity,
    );
  };

  const setAutomaticSensitivity = (enabled: boolean) => {
    voiceSettingsController.setAutoDetectSensitivity(enabled);
    micTestRef.current.updateGateSettings(inputMode, enabled, vadSensitivity);
  };

  const setSensitivity = (value: number) => {
    voiceSettingsController.setVADSensitivity(value);
    micTestRef.current.updateGateSettings(inputMode, false, value);
  };

  useEffect(() => {
    if (!isOpen) stopMicTest();
  }, [isOpen, stopMicTest]);

  useEffect(
    () => () => {
      micTestRef.current.stop();
      restoreCallAfterTest();
    },
    [restoreCallAfterTest],
  );

  useEffect(() => {
    if (!isOpen || isTesting) return;
    const timer = window.setInterval(() => {
      setCallLevel(optimizedVoiceService.getCurrentVolume());
    }, 80);
    return () => window.clearInterval(timer);
  }, [isOpen, isTesting]);

  useEffect(() => {
    if (!isRecordingPTT) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      voiceSettingsController.setPTTKey(event.code);
      setIsRecordingPTT(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isRecordingPTT]);

  if (!isOpen) return null;

  const updateProfile = async (nextProfile: VoiceProcessingProfile) => {
    await voiceSettingsController.setProfile(nextProfile);
    await restartMicTest();
  };

  const updateProcessing = async (
    settings: Partial<VoiceProcessingSettings>,
  ) => {
    await voiceSettingsController.updateProcessing(settings);
    await restartMicTest();
  };

  const changeInputDevice = async (deviceId: string) => {
    try {
      await voiceSettingsController.setInputDevice(deviceId);
      rememberInput(voiceSettingsController.getSnapshot().inputDeviceId);
      await restartMicTest();
      setTestError(null);
    } catch (error) {
      setTestError(
        error instanceof Error ? error.message : 'Микрофон недоступен',
      );
    }
  };

  const changeOutputDevice = async (deviceId: string) => {
    try {
      await voiceSettingsController.setOutputDevice(deviceId);
      rememberOutput(deviceId);
      await restartMicTest();
      setTestError(null);
    } catch (error) {
      setTestError(
        error instanceof Error ? error.message : 'Устройство вывода недоступно',
      );
    }
  };

  const shownRuntime = isTesting && testRuntime
    ? testRuntime
    : {
        status: runtimeStatus,
        message: runtimeMessage,
        engine:
          audioProcessingService.getDiagnostics().activeEngine ??
          activeRuntimeEngine,
      };
  const displayedLevel = isTesting ? testLevel : callLevel;
  const diagnostics = optimizedVoiceService.getDiagnostics();

  return (
    <div className="voice-video-settings mx-auto max-w-[760px] pb-16 text-[#dbdee1]">
      <h2 className="voice-video-settings__title mb-7 text-2xl font-semibold text-white">Голос и видео</h2>

      <section className="space-y-5">
        <h3 className="text-xl font-semibold text-white">Голос</h3>
        <div className="voice-video-settings__device-grid grid grid-cols-2 gap-4">
          <DeviceSelect
            icon={<Mic size={16} />}
            label="Микрофон"
            value={selectedInputDeviceId}
            devices={inputDevices}
            onChange={(value) => void changeInputDevice(value)}
          />
          <DeviceSelect
            icon={<Headphones size={16} />}
            label="Динамик"
            value={selectedOutputDeviceId}
            devices={outputDevices}
            onChange={(value) => void changeOutputDevice(value)}
          />
        </div>

        <div className="voice-video-settings__volume-grid grid grid-cols-2 gap-4">
          <LabeledSlider
            label={`Громкость микрофона · ${inputVolume}%`}
            value={inputVolume}
            max={MAX_INPUT_VOLUME_PERCENT}
            onChange={(value) => {
              voiceSettingsController.setInputVolume(value);
              void restartMicTest();
            }}
          />
          <LabeledSlider
            label="Громкость динамика"
            value={outputVolume}
            onChange={(value) => {
              voiceSettingsController.setOutputVolume(value);
              void restartMicTest();
            }}
          />
        </div>

        <div className="voice-video-settings__mic-test flex items-center gap-3">
          <button
            type="button"
            onClick={() => void (isTesting ? stopMicTest() : startMicTest())}
            className={cn(
              'min-w-[176px] rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-colors',
              isTesting
                ? 'bg-[#da373c] hover:bg-[#a1282c]'
                : 'bg-[#5865f2] hover:bg-[#4752c4]',
            )}
          >
            {isTesting ? 'Остановить проверку' : 'Проверить микрофон'}
          </button>
          <div className="flex h-9 flex-1 items-center gap-1 rounded-md bg-[#1e1f22] px-2">
            {Array.from({ length: 30 }, (_, index) => (
              <span
                key={index}
                className={cn(
                  'h-3 flex-1 rounded-full transition-colors',
                  index / 30 < displayedLevel
                    ? 'bg-[#23a55a]'
                    : 'bg-[#4e5058]',
                )}
              />
            ))}
          </div>
        </div>
        {testError && <p className="text-sm text-[#f23f42]">{testError}</p>}
        <p className="text-sm text-[#949ba4]">
          Во время проверки активный звонок временно заглушается, затем прежние
          состояния микрофона и наушников восстанавливаются.
        </p>
      </section>

      <Divider />

      <section className="space-y-5">
        <h3 className="text-xl font-semibold text-white">Режим ввода</h3>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            checked={inputMode === 'voice-activity'}
            onChange={() => setInputMode('voice-activity')}
            className="mt-1 h-5 w-5 accent-[#5865f2]"
          />
          <span>
            <span className="block font-semibold">Определение голосовой активности</span>
            <span className="text-sm text-[#949ba4]">
              Передаёт голос только после срабатывания порога. Короткая задержка закрытия сохраняет окончания слов.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="radio"
            checked={inputMode === 'push-to-talk'}
            onChange={() => setInputMode('push-to-talk')}
            className="mt-1 h-5 w-5 accent-[#5865f2]"
          />
          <span>
            <span className="block font-semibold">Режим рации</span>
            <span className="text-sm text-[#949ba4]">
              В браузере PTT работает только пока вкладка активна.
            </span>
          </span>
        </label>

        {inputMode === 'voice-activity' ? (
          <div className="space-y-4 rounded-lg bg-[#2b2d31] p-4">
            <SettingSwitch
              title="Автоматически определять чувствительность"
              description="Выключите, чтобы настроить порог вручную."
              checked={autoDetectSensitivity}
              onChange={setAutomaticSensitivity}
            />
            {!autoDetectSensitivity && (
              <SensitivitySlider
                value={vadSensitivity}
                inputLevel={testLevel}
                monitoring={isTesting}
                gateOpen={testGateOpen}
                onChange={setSensitivity}
              />
            )}
          </div>
        ) : (
          <div className="space-y-4 rounded-lg bg-[#2b2d31] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-white">Клавиша PTT</p>
                <p className="text-sm text-[#949ba4]">
                  Нажмите кнопку и затем нужную клавишу.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRecordingPTT(true)}
                className={cn(
                  'min-w-[132px] rounded-md px-3 py-2 text-sm font-semibold',
                  isRecordingPTT
                    ? 'bg-[#f0b232] text-[#1e1f22]'
                    : 'bg-[#4e5058] text-white hover:bg-[#5d6069]',
                )}
              >
                {isRecordingPTT ? 'Нажмите клавишу' : pttKey}
              </button>
            </div>
            <LabeledSlider
              label={`Задержка отпускания · ${pttDelay} мс`}
              value={pttDelay}
              min={0}
              max={2000}
              onChange={(value) => voiceSettingsController.setPTTDelay(value)}
            />
          </div>
        )}
      </section>

      <Divider />

      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-white">Профиль ввода</h3>
        {(Object.keys(PROFILE_COPY) as VoiceProcessingProfile[]).map(
          (profileId) => (
            <label
              key={profileId}
              className="flex cursor-pointer items-start gap-3"
            >
              <input
                type="radio"
                name="voice-profile"
                checked={profile === profileId}
                onChange={() => void updateProfile(profileId)}
                className="mt-1 h-5 w-5 accent-[#5865f2]"
              />
              <span>
                <span className="block font-semibold text-[#dbdee1]">
                  {PROFILE_COPY[profileId].title}
                </span>
                <span className="text-sm text-[#949ba4]">
                  {PROFILE_COPY[profileId].description}
                </span>
              </span>
            </label>
          ),
        )}

        <div className="rounded-lg border border-[#3f4147] bg-[#2b2d31] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-white">Фактическая обработка</p>
              <p className="text-sm text-[#b5bac1]">
                {statusLabel(shownRuntime.status)}
                {shownRuntime.engine
                  ? ` · ${ENGINE_LABELS[shownRuntime.engine as NoiseSuppressionEngine] ?? shownRuntime.engine}`
                  : ''}
              </p>
            </div>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                shownRuntime.status === 'active'
                  ? 'bg-[#1f6f46] text-[#b5f5d0]'
                  : shownRuntime.status === 'error'
                    ? 'bg-[#7d292d] text-[#ffd4d6]'
                    : 'bg-[#404249] text-[#dbdee1]',
              )}
            >
              {statusLabel(shownRuntime.status)}
            </span>
          </div>
          {shownRuntime.message && (
            <p className="mt-2 text-sm text-[#f0b232]">
              {shownRuntime.message}
            </p>
          )}
          {diagnostics.unsupportedConstraints.length > 0 && (
            <p className="mt-2 text-sm text-[#949ba4]">
              Браузер не поддерживает: {diagnostics.unsupportedConstraints.join(', ')}
            </p>
          )}
        </div>
      </section>

      {profile === 'custom' && (
        <>
          <Divider />
          <section className="space-y-5">
            <h3 className="text-xl font-semibold text-white">
              Ручная обработка
            </h3>
            <SettingSwitch
              title="Шумоподавление"
              description="AI и браузерный шумодав не включаются одновременно."
              checked={customSettings.noiseSuppression}
              onChange={(checked) =>
                void updateProcessing({ noiseSuppression: checked })
              }
            />
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase text-[#b5bac1]">
                Движок шумоподавления
              </span>
              <select
                value={customSettings.noiseSuppressionEngine}
                disabled={!customSettings.noiseSuppression}
                onChange={(event) =>
                  void updateProcessing({
                    noiseSuppressionEngine: event.target
                      .value as NoiseSuppressionEngine,
                  })
                }
                className="h-10 w-full rounded-md bg-[#1e1f22] px-3 text-sm text-[#dbdee1] outline-none disabled:opacity-50"
              >
                {(Object.keys(ENGINE_LABELS) as NoiseSuppressionEngine[]).map(
                  (engine) => (
                    <option
                      key={engine}
                      value={engine}
                      disabled={
                        engine !== 'browser' && !supportedEngines.has(engine)
                      }
                    >
                      {ENGINE_LABELS[engine]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <SettingSwitch
              title="Эхоподавление"
              description="Убирает звук динамиков из микрофона, если браузер поддерживает constraint."
              checked={customSettings.echoCancellation}
              onChange={(checked) =>
                void updateProcessing({ echoCancellation: checked })
              }
            />
            <SettingSwitch
              title="Автоматическая регулировка усиления"
              description="Выравнивает громкость голоса. С нейросетевым движком работает после шумоподавления, поэтому не усиливает шум."
              checked={customSettings.autoGainControl}
              onChange={(checked) =>
                void updateProcessing({ autoGainControl: checked })
              }
            />
            <SettingSwitch
              title="Обработка голоса"
              description="High-pass, компрессор и компенсация громкости."
              checked={customSettings.voiceConditioning}
              onChange={(checked) =>
                void updateProcessing({ voiceConditioning: checked })
              }
            />
          </section>
        </>
      )}
      <VoiceSoundSettings />
    </div>
  );
};

export default VoiceVideoSettings;
export { VoiceVideoSettings };
