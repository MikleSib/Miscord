import React, { useState } from 'react';
import { X, Mic, Volume2, Settings } from 'lucide-react';
import { audioProcessingService, AudioProcessingConfig } from '../services/audioProcessingService';

interface AudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AudioSettingsModal: React.FC<AudioSettingsModalProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<AudioProcessingConfig>({
    vadEnabled: true,
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    speechProbabilityThreshold: 0.5,
    useAdvancedNoiseSuppression: false
  });

  if (!isOpen) return null;

  const handleConfigChange = (key: keyof AudioProcessingConfig, value: boolean | number) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    audioProcessingService.updateConfig(newConfig);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#313338] rounded-lg w-[500px] max-h-[80vh] overflow-hidden">
        {/* Заголовок */}
        <div className="flex items-center justify-between p-4 border-b border-[#3f4147]">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Настройки аудио
          </h2>
          <button
            onClick={onClose}
            className="text-[#b5bac1] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Содержимое */}
        <div className="p-4 space-y-6">
          {/* VAD настройки */}
          <div className="space-y-4">
            <h3 className="text-white font-medium flex items-center gap-2">
              <Mic className="w-4 h-4" />
              Детекция голоса (VAD)
            </h3>
            
            <label className="flex items-center justify-between">
              <span className="text-[#b5bac1]">Включить детекцию голоса</span>
              <input
                type="checkbox"
                checked={config.vadEnabled}
                onChange={(e) => handleConfigChange('vadEnabled', e.target.checked)}
                className="w-4 h-4 rounded"
              />
            </label>

            <div className="space-y-2">
              <label className="text-[#b5bac1] text-sm">
                Чувствительность VAD: {Math.round((1 - config.speechProbabilityThreshold) * 100)}%
              </label>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.1"
                value={1 - config.speechProbabilityThreshold}
                onChange={(e) => handleConfigChange('speechProbabilityThreshold', 1 - parseFloat(e.target.value))}
                className="w-full"
                disabled={!config.vadEnabled}
              />
              <div className="flex justify-between text-xs text-[#949ba4]">
                <span>Низкая</span>
                <span>Высокая</span>
              </div>
              <p className="text-xs text-[#949ba4] mt-1">
                Текущий порог: {config.speechProbabilityThreshold.toFixed(1)} (меньше = чувствительнее)
              </p>
            </div>
          </div>

          {/* Обработка звука */}
          <div className="space-y-4">
            <h3 className="text-white font-medium flex items-center gap-2">
              <Volume2 className="w-4 h-4" />
              Обработка звука
            </h3>

            <label className="flex items-center justify-between">
              <div>
                <span className="text-[#b5bac1]">Шумоподавление</span>
                <p className="text-xs text-[#949ba4]">Убирает фоновый шум</p>
              </div>
              <input
                type="checkbox"
                checked={config.noiseSuppression}
                onChange={(e) => handleConfigChange('noiseSuppression', e.target.checked)}
                className="w-4 h-4 rounded"
              />
            </label>

            {config.noiseSuppression && (
              <>
                <label className="flex items-center justify-between ml-6">
                  <div>
                    <span className="text-[#b5bac1]">Продвинутое шумоподавление</span>
                    <p className="text-xs text-[#949ba4]">Адаптивный noise gate с анализом спектра</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.useAdvancedNoiseSuppression}
                    onChange={(e) => handleConfigChange('useAdvancedNoiseSuppression', e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                </label>
                
                {config.useAdvancedNoiseSuppression && (
                  <div className="ml-6 space-y-2 p-3 bg-[#2b2d31] rounded">
                    <p className="text-xs text-[#949ba4]">
                      <strong>Совет:</strong> Продвинутое шумоподавление агрессивно фильтрует дыхание, клики мыши и клавиатуру. 
                      Если голос звучит неестественно, попробуйте отключить эту опцию.
                    </p>
                    <p className="text-xs text-[#949ba4]">
                      • Фильтр низких частот: убирает дыхание и гул<br/>
                      • Фильтр высоких частот: убирает клики и шипение<br/>
                      • 3 режекторных фильтра: специально для мыши и клавиатуры<br/>
                      • Адаптивный порог: автоматически подстраивается под голос<br/>
                      • Детекция импульсов: подавляет резкие звуки
                    </p>
                  </div>
                )}
              </>
            )}

            <label className="flex items-center justify-between">
              <div>
                <span className="text-[#b5bac1]">Подавление эха</span>
                <p className="text-xs text-[#949ba4]">Убирает эхо от динамиков</p>
              </div>
              <input
                type="checkbox"
                checked={config.echoCancellation}
                onChange={(e) => handleConfigChange('echoCancellation', e.target.checked)}
                className="w-4 h-4 rounded"
              />
            </label>

            <label className="flex items-center justify-between">
              <div>
                <span className="text-[#b5bac1]">Автоматическая регулировка громкости</span>
                <p className="text-xs text-[#949ba4]">Выравнивает уровень голоса</p>
              </div>
              <input
                type="checkbox"
                checked={config.autoGainControl}
                onChange={(e) => handleConfigChange('autoGainControl', e.target.checked)}
                className="w-4 h-4 rounded"
              />
            </label>
          </div>
        </div>

        {/* Подвал */}
        <div className="p-4 border-t border-[#3f4147] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#5865f2] text-white rounded hover:bg-[#4752c4] transition-colors"
          >
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}; 