import React, { useEffect, useState } from 'react';
import { useVADSettingsStore } from '../store/vadSettingsStore';
import { Slider } from './ui/slider';
import voiceService from '../services/voiceService';

export const VoiceInputSettings: React.FC = () => {
  const {
    inputMode,
    vadSensitivity,
    autoDetectSensitivity,
    pttKey,
    pttDelay,
    setInputMode,
    setVADSensitivity,
    setAutoDetectSensitivity,
    setPTTKey,
    setPTTDelay,
  } = useVADSettingsStore();

  const [isRecordingKey, setIsRecordingKey] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);

  // Получаем текущий уровень громкости от voiceService
  useEffect(() => {
    const updateVolume = () => {
      if (voiceService && typeof voiceService.getCurrentVolume === 'function') {
        const volume = voiceService.getCurrentVolume();
        setCurrentVolume(volume || 0);
      }
    };

    const interval = setInterval(updateVolume, 100);
    return () => clearInterval(interval);
  }, []);

  // Применяем настройки VAD к voiceService при изменении
  useEffect(() => {
    if (voiceService && typeof voiceService.updateVADThresholds === 'function') {
      voiceService.updateVADThresholds(vadSensitivity);
    }
  }, [vadSensitivity]);

  // Применяем режим ввода
  useEffect(() => {
    if (voiceService && typeof voiceService.setInputMode === 'function') {
      voiceService.setInputMode(inputMode);
    }
  }, [inputMode]);

  // Обработка записи клавиши для PTT
  useEffect(() => {
    if (!isRecordingKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      const key = e.code;
      setPTTKey(key);
      setIsRecordingKey(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecordingKey, setPTTKey]);

  // Получаем читаемое имя клавиши
  const getKeyDisplayName = (key: string): string => {
    const keyMap: { [key: string]: string } = {
      'Space': 'Пробел',
      'ControlLeft': 'Левый Ctrl',
      'ControlRight': 'Правый Ctrl',
      'ShiftLeft': 'Левый Shift',
      'ShiftRight': 'Правый Shift',
      'AltLeft': 'Левый Alt',
      'AltRight': 'Правый Alt',
      'KeyV': 'V',
      'KeyB': 'B',
      'KeyC': 'C',
      'KeyX': 'X',
      'KeyZ': 'Z',
    };
    return keyMap[key] || key.replace('Key', '');
  };

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground">Настройки ввода голоса</h2>
      </div>

      {/* Режим ввода */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-foreground">Режим ввода</h3>

        <div className="space-y-3">
          {/* Активация по голосу */}
          <label className={`flex items-center space-x-4 p-4 rounded-lg cursor-pointer transition-colors ${
            inputMode === 'voice-activity'
              ? 'bg-primary/10 border-2 border-primary'
              : 'bg-secondary hover:bg-accent border-2 border-transparent'
          }`}>
            <div className="relative">
              <input
                type="radio"
                name="input-mode"
                checked={inputMode === 'voice-activity'}
                onChange={() => setInputMode('voice-activity')}
                className="sr-only"
              />
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                inputMode === 'voice-activity'
                  ? 'border-primary bg-primary'
                  : 'border-border bg-background'
              }`}>
                {inputMode === 'voice-activity' && (
                  <div className="w-3 h-3 rounded-full bg-primary-foreground"></div>
                )}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-foreground font-medium">Активация по голосу</div>
              <div className="text-sm text-muted-foreground">Микрофон автоматически включается при обнаружении речи</div>
            </div>
          </label>

          {/* Режим рации */}
          <label className={`flex items-center space-x-4 p-4 rounded-lg cursor-pointer transition-colors ${
            inputMode === 'push-to-talk'
              ? 'bg-primary/10 border-2 border-primary'
              : 'bg-secondary hover:bg-accent border-2 border-transparent'
          }`}>
            <div className="relative">
              <input
                type="radio"
                name="input-mode"
                checked={inputMode === 'push-to-talk'}
                onChange={() => setInputMode('push-to-talk')}
                className="sr-only"
              />
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                inputMode === 'push-to-talk'
                  ? 'border-primary bg-primary'
                  : 'border-border bg-background'
              }`}>
                {inputMode === 'push-to-talk' && (
                  <div className="w-3 h-3 rounded-full bg-primary-foreground"></div>
                )}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-foreground font-medium">Режим рации</div>
              <div className="text-sm text-muted-foreground">Микрофон включается только при нажатии клавиши</div>
            </div>
          </label>
        </div>
      </div>

      {/* Настройки чувствительности (только для режима голоса) */}
      {inputMode === 'voice-activity' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-foreground">Чувствительность ввода</h3>
            {autoDetectSensitivity && (
              <button
                onClick={() => setAutoDetectSensitivity(false)}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center space-x-2 bg-secondary px-3 py-1 rounded-md hover:bg-accent transition-colors"
              >
                <span>✕</span>
                <span>Автоматически определять чувствительность устройства ввода</span>
              </button>
            )}
          </div>

          {!autoDetectSensitivity ? (
            <div className="space-y-4">
              <div className="bg-secondary p-4 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-foreground">Чувствительность: {vadSensitivity}%</span>
                  <div className="flex space-x-2">
                    <span className="text-xs text-muted-foreground">Низкая</span>
                    <span className="text-xs text-muted-foreground">Высокая</span>
                  </div>
                </div>

                <Slider
                  value={[vadSensitivity]}
                  onValueChange={(values: number[]) => setVADSensitivity(values[0])}
                  min={0}
                  max={100}
                  step={1}
                  className="w-full mb-3"
                />

                {/* Индикатор уровня громкости */}
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Текущий уровень микрофона</div>
                  <div className="h-3 bg-background rounded-full overflow-hidden relative border border-border">
                    <div
                      className="h-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 transition-all duration-100"
                      style={{ width: `${currentVolume}%` }}
                    />
                    {/* Порог чувствительности */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-lg"
                      style={{ left: `${vadSensitivity}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Микрофон активируется когда уровень звука превышает порог (синяя линия)
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-secondary p-4 rounded-lg border border-border">
              <div className="flex items-center space-x-3">
                <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-foreground">Автоматически определяет оптимальную чувствительность для вашего микрофона</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Настройки PTT */}
      {inputMode === 'push-to-talk' && (
        <div className="space-y-6">
          {/* Сочетание клавиш */}
          <div className="space-y-3">
            <h3 className="text-lg font-medium text-foreground">Сочетание клавиш</h3>
            <div className="bg-secondary p-4 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-foreground mb-1">Горячая клавиша</div>
                  <div className="text-sm text-muted-foreground">Нажмите клавишу для настройки</div>
                </div>
                <button
                  onClick={() => setIsRecordingKey(true)}
                  className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                    isRecordingKey
                      ? 'bg-primary text-primary-foreground animate-pulse'
                      : 'bg-accent text-accent-foreground hover:bg-accent/80'
                  }`}
                >
                  {isRecordingKey ? 'Нажмите клавишу...' : getKeyDisplayName(pttKey)}
                </button>
              </div>
            </div>
          </div>

          {/* Задержка отключения */}
          <div className="space-y-3">
            <h3 className="text-lg font-medium text-foreground">Задержка отключения в режиме рации</h3>
            <div className="bg-secondary p-4 rounded-lg border border-border">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-foreground">Задержка: {pttDelay}мс</span>
                  <span className="text-sm text-muted-foreground">0мс - 2000мс</span>
                </div>
                <Slider
                  value={[pttDelay]}
                  onValueChange={(values: number[]) => setPTTDelay(values[0])}
                  min={0}
                  max={2000}
                  step={50}
                  className="w-full"
                />
                <div className="text-xs text-muted-foreground">
                  Время задержки перед отключением микрофона после отпускания клавиши
                </div>
              </div>
            </div>
          </div>

          <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg">
            <div className="text-sm text-primary">
              💡 Вы можете добавить несколько комбинаций для режима рации в
              <span className="text-primary hover:text-primary/80 cursor-pointer underline ml-1">
                настройках горячих клавиш
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
