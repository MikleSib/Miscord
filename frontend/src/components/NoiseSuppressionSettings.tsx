import React, { useState, useEffect } from 'react';
import { audioProcessingService, NoiseSuppressionEngine } from '../services/audioProcessingService';
import { Label } from './ui/label.js';
import { RadioGroup, RadioGroupItem } from './ui/radio-group.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.js';
import { Alert, AlertDescription } from './ui/alert.js';
import { Info, Zap, Shield, Cpu } from 'lucide-react';

interface NoiseSuppressionSettingsProps {
  currentEngine?: NoiseSuppressionEngine;
  onEngineChange?: (engine: NoiseSuppressionEngine) => void;
}

export const NoiseSuppressionSettings: React.FC<NoiseSuppressionSettingsProps> = ({
  currentEngine = 'browser',
  onEngineChange,
}) => {
  const [selectedEngine, setSelectedEngine] = useState<NoiseSuppressionEngine>(currentEngine);
  const [supportedEngines, setSupportedEngines] = useState<
    { engine: NoiseSuppressionEngine; supported: boolean; name: string }[]
  >([]);

  useEffect(() => {
    // Получаем список поддерживаемых движков
    const engines = audioProcessingService.getSupportedEngines();
    setSupportedEngines(engines);
  }, []);

  const handleEngineChange = (value: string) => {
    const engine = value as NoiseSuppressionEngine;
    setSelectedEngine(engine);
    onEngineChange?.(engine);
  };

  const getEngineIcon = (engine: NoiseSuppressionEngine) => {
    switch (engine) {
      case 'browser':
        return <Shield className="w-5 h-5" />;
      case 'rnnoise':
        return <Cpu className="w-5 h-5" />;
      case 'deepfilternet':
        return <Zap className="w-5 h-5" />;
      default:
        return null;
    }
  };

  const getEngineDescription = (engine: NoiseSuppressionEngine) => {
    switch (engine) {
      case 'browser':
        return 'Использует встроенные браузерные алгоритмы. Низкая нагрузка на CPU, базовое качество.';
      case 'rnnoise':
        return 'Классический ML-алгоритм. Средняя нагрузка на CPU, хорошее качество.';
      case 'deepfilternet':
        return 'Продвинутый Deep Learning. Высокая нагрузка на CPU, отличное качество для всего спектра (48kHz).';
      default:
        return '';
    }
  };

  const getEnginePerformance = (engine: NoiseSuppressionEngine) => {
    switch (engine) {
      case 'browser':
        return { cpu: 'Низкая', latency: '~5ms', quality: 'Базовое' };
      case 'rnnoise':
        return { cpu: 'Средняя', latency: '~10-15ms', quality: 'Хорошее' };
      case 'deepfilternet':
        return { cpu: 'Высокая', latency: '~20-30ms', quality: 'Отличное' };
      default:
        return { cpu: '-', latency: '-', quality: '-' };
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Движок шумоподавления
        </CardTitle>
        <CardDescription>
          Выберите алгоритм шумоподавления в зависимости от ваших требований к качеству и производительности
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={selectedEngine} onValueChange={handleEngineChange}>
          {supportedEngines.map(({ engine, supported, name }) => {
            const perf = getEnginePerformance(engine);
            const isSelected = selectedEngine === engine;

            return (
              <div
                key={engine}
                className={`relative flex items-start space-x-3 rounded-lg border p-4 transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                } ${!supported ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <RadioGroupItem
                  value={engine}
                  id={engine}
                  disabled={!supported}
                  className="mt-1"
                />
                <div className="flex-1 space-y-2">
                  <Label
                    htmlFor={engine}
                    className={`flex items-center gap-2 font-medium ${
                      !supported ? 'cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    {getEngineIcon(engine)}
                    {name}
                    {!supported && (
                      <span className="text-xs text-red-500">(Не поддерживается)</span>
                    )}
                  </Label>
                  
                  <p className="text-sm text-gray-600">{getEngineDescription(engine)}</p>
                  
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">CPU:</span>{' '}
                      <span className="font-medium">{perf.cpu}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Задержка:</span>{' '}
                      <span className="font-medium">{perf.latency}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Качество:</span>{' '}
                      <span className="font-medium">{perf.quality}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </RadioGroup>

        {selectedEngine === 'deepfilternet' && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>DeepFilterNet</strong> обеспечивает наилучшее качество шумоподавления, но требует:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Современный процессор (рекомендуется 4+ ядра)</li>
                <li>Поддержку WebAssembly SIMD</li>
                <li>~50MB оперативной памяти для модели</li>
                <li>Первоначальную загрузку модели (~10MB)</li>
              </ul>
              <p className="mt-2 text-sm">
                Если вы испытываете проблемы с производительностью, переключитесь на RNNoise или браузерные фильтры.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {selectedEngine === 'rnnoise' && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>RNNoise</strong> - проверенный алгоритм, который обеспечивает хороший баланс между качеством и производительностью.
              Подходит для большинства случаев использования.
            </AlertDescription>
          </Alert>
        )}

        {selectedEngine === 'browser' && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Браузерные фильтры</strong> используют встроенные возможности браузера.
              Это самый легковесный вариант, но качество может быть ниже чем у специализированных алгоритмов.
            </AlertDescription>
          </Alert>
        )}

        <div className="pt-4 border-t">
          <p className="text-xs text-gray-500">
            💡 <strong>Совет:</strong> Начните с браузерных фильтров и переключайтесь на более продвинутые движки только если нужно лучшее качество.
            Изменение движка требует переподключения к голосовому каналу.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
