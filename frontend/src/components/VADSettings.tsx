import React, { useEffect, useState } from 'react';
import { useVADSettingsStore } from '../store/vadSettingsStore';
import { Slider } from './ui/slider';
import voiceService from '../services/voiceService';

export const VADSettings: React.FC = () => {
  const {
    inputMode,
    vadSensitivity,
    autoDetectSensitivity,
    pttKey,
    setInputMode,
    setVADSensitivity,
    setAutoDetectSensitivity,
    setPTTKey,
  } = useVADSettingsStore();

  const [isRecordingKey, setIsRecordingKey] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);

  // Получаем текущий уровень громкости от voiceService
  useEffect(() => {
    const updateVolume = () => {
      if (voiceService && typeof (voiceService as any).getCurrentVolume === 'function') {
        const volume = (voiceService as any).getCurrentVolume();
        setCurrentVolume(volume || 0);
      }
    };

    const interval = setInterval(updateVolume, 100);
    return () => clearInterval(interval);
  }, []);

  // Применяем настройки VAD к voiceService при изменении
  useEffect(() => {
    if (voiceService && typeof (voiceService as any).updateVADThresholds === 'function') {
      (voiceService as any).updateVADThresholds(vadSensitivity);
    }
  }, [vadSensitivity]);

  // Применяем режим ввода
  useEffect(() => {
    if (voiceService && typeof (voiceService as any).setInputMode === 'function') {
      (voiceService as any).setInputMode(inputMode);
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
    };
    return keyMap[key] || key;
  };

  return (
    <div className="space-y-6 p-4 bg-gray-800 rounded-lg">
      {/* Режим ввода */}
      <div>
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Режим ввода</h3>
        
        <div className="space-y-2">
          {/* Активация по голосу */}
          <label className="flex items-center space-x-3 cursor-pointer group">
            <div className="relative">
              <input
                type="radio"
                name="input-mode"
                checked={inputMode === 'voice-activity'}
                onChange={() => setInputMode('voice-activity')}
                className="sr-only"
              />
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                inputMode === 'voice-activity' 
                  ? 'border-blue-500 bg-blue-500' 
                  : 'border-gray-500 bg-transparent group-hover:border-gray-400'
              }`}>
                {inputMode === 'voice-activity' && (
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                )}
              </div>
            </div>
            <span className="text-gray-200 text-sm">Активация по голосу</span>
          </label>

          {/* Режим рации */}
          <label className="flex items-center space-x-3 cursor-pointer group">
            <div className="relative">
              <input
                type="radio"
                name="input-mode"
                checked={inputMode === 'push-to-talk'}
                onChange={() => setInputMode('push-to-talk')}
                className="sr-only"
              />
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                inputMode === 'push-to-talk' 
                  ? 'border-blue-500 bg-blue-500' 
                  : 'border-gray-500 bg-transparent group-hover:border-gray-400'
              }`}>
                {inputMode === 'push-to-talk' && (
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                )}
              </div>
            </div>
            <span className="text-gray-200 text-sm">Режим рации</span>
          </label>
        </div>
      </div>

      {/* Настройки VAD */}
      {inputMode === 'voice-activity' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-200">Чувствительность ввода</h3>
            {autoDetectSensitivity && (
              <button
                onClick={() => setAutoDetectSensitivity(false)}
                className="text-xs text-gray-400 hover:text-gray-300 flex items-center space-x-1"
              >
                <span>✕</span>
                <span>Автоматически определять чувствительность устройства ввода</span>
              </button>
            )}
          </div>

          {!autoDetectSensitivity && (
            <div className="space-y-2">
              <Slider
                value={[vadSensitivity]}
                onValueChange={(values: number[]) => setVADSensitivity(values[0])}
                min={0}
                max={100}
                step={1}
                className="w-full"
              />
              
              {/* Индикатор уровня */}
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden relative">
                <div 
                  className="h-full bg-gradient-to-r from-orange-500 via-yellow-400 to-green-500 transition-all duration-100"
                  style={{ width: `${currentVolume}%` }}
                />
                {/* Порог */}
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                  style={{ left: `${vadSensitivity}%` }}
                />
              </div>
              
              <p className="text-xs text-gray-400">
                Микрофон активируется когда уровень звука превышает порог (красная линия)
              </p>
            </div>
          )}
        </div>
      )}

      {/* Настройки PTT */}
      {inputMode === 'push-to-talk' && (
        <div>
          <h3 className="text-sm font-semibold text-gray-200 mb-2">Сочетание клавиш</h3>
          
          <button
            onClick={() => setIsRecordingKey(true)}
            className={`w-full px-4 py-2 rounded text-sm font-medium transition-colors ${
              isRecordingKey
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
            }`}
          >
            {isRecordingKey ? 'Нажмите клавишу...' : getKeyDisplayName(pttKey)}
          </button>
          
          <p className="text-xs text-gray-400 mt-2">
            Удерживайте клавишу для передачи голоса
          </p>
        </div>
      )}
    </div>
  );
};
