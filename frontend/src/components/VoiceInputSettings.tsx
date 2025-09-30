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
    <div className="space-y-6 p-6 bg-gray-800 rounded-lg">
      {/* Заголовок */}
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-white">Настройки ввода голоса</h2>
      </div>

      {/* Режим ввода */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium text-gray-200">Режим ввода</h3>
        
        <div className="space-y-3">
          {/* Активация по голосу */}
          <label className={`flex items-center space-x-4 p-4 rounded-lg cursor-pointer transition-colors ${
            inputMode === 'voice-activity' 
              ? 'bg-blue-500/20 border-2 border-blue-500' 
              : 'bg-gray-700 hover:bg-gray-600 border-2 border-transparent'
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
                  ? 'border-blue-500 bg-blue-500' 
                  : 'border-gray-400 bg-transparent'
              }`}>
                {inputMode === 'voice-activity' && (
                  <div className="w-3 h-3 rounded-full bg-white"></div>
                )}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-white font-medium">Активация по голосу</div>
              <div className="text-sm text-gray-400">Микрофон автоматически включается при обнаружении речи</div>
            </div>
          </label>

          {/* Режим рации */}
          <label className={`flex items-center space-x-4 p-4 rounded-lg cursor-pointer transition-colors ${
            inputMode === 'push-to-talk' 
              ? 'bg-blue-500/20 border-2 border-blue-500' 
              : 'bg-gray-700 hover:bg-gray-600 border-2 border-transparent'
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
                  ? 'border-blue-500 bg-blue-500' 
                  : 'border-gray-400 bg-transparent'
              }`}>
                {inputMode === 'push-to-talk' && (
                  <div className="w-3 h-3 rounded-full bg-white"></div>
                )}
              </div>
            </div>
            <div className="flex-1">
              <div className="text-white font-medium">Режим рации</div>
              <div className="text-sm text-gray-400">Микрофон включается только при нажатии клавиши</div>
            </div>
          </label>
        </div>
      </div>

      {/* Настройки чувствительности (только для режима голоса) */}
      {inputMode === 'voice-activity' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-200">Чувствительность ввода</h3>
            {autoDetectSensitivity && (
              <button
                onClick={() => setAutoDetectSensitivity(false)}
                className="text-sm text-gray-400 hover:text-gray-300 flex items-center space-x-2 bg-gray-700 px-3 py-1 rounded-md hover:bg-gray-600 transition-colors"
              >
                <span>✕</span>
                <span>Автоматически определять чувствительность устройства ввода</span>
              </button>
            )}
          </div>

          {!autoDetectSensitivity ? (
            <div className="space-y-4">
              <div className="bg-gray-700 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-gray-300">Чувствительность: {vadSensitivity}%</span>
                  <div className="flex space-x-2">
                    <span className="text-xs text-gray-500">Низкая</span>
                    <span className="text-xs text-gray-500">Высокая</span>
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
                  <div className="text-xs text-gray-400">Текущий уровень микрофона</div>
                  <div className="h-3 bg-gray-600 rounded-full overflow-hidden relative">
                    <div 
                      className="h-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500 transition-all duration-100"
                      style={{ width: `${currentVolume}%` }}
                    />
                    {/* Порог чувствительности */}
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-500 shadow-lg"
                      style={{ left: `${vadSensitivity}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500">
                    Микрофон активируется когда уровень звука превышает порог (синяя линия)
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-700 p-4 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-4 h-4 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-gray-300">Автоматически определяет оптимальную чувствительность для вашего микрофона</span>
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
            <h3 className="text-lg font-medium text-gray-200">Сочетание клавиш</h3>
            <div className="bg-gray-700 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-gray-300 mb-1">Горячая клавиша</div>
                  <div className="text-sm text-gray-500">Нажмите клавишу для настройки</div>
                </div>
                <button
                  onClick={() => setIsRecordingKey(true)}
                  className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                    isRecordingKey
                      ? 'bg-blue-600 text-white animate-pulse'
                      : 'bg-gray-600 text-gray-200 hover:bg-gray-500'
                  }`}
                >
                  {isRecordingKey ? 'Нажмите клавишу...' : getKeyDisplayName(pttKey)}
                </button>
              </div>
            </div>
          </div>

          {/* Задержка отключения */}
          <div className="space-y-3">
            <h3 className="text-lg font-medium text-gray-200">Задержка отключения в режиме рации</h3>
            <div className="bg-gray-700 p-4 rounded-lg">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Задержка: {pttDelay}мс</span>
                  <span className="text-sm text-gray-500">0мс - 2000мс</span>
                </div>
                <Slider
                  value={[pttDelay]}
                  onValueChange={(values: number[]) => setPTTDelay(values[0])}
                  min={0}
                  max={2000}
                  step={50}
                  className="w-full"
                />
                <div className="text-xs text-gray-500">
                  Время задержки перед отключением микрофона после отпускания клавиши
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
            <div className="text-sm text-blue-300">
              💡 Вы можете добавить несколько комбинаций для режима рации в 
              <span className="text-blue-400 hover:text-blue-300 cursor-pointer underline ml-1">
                настройках горячих клавиш
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
