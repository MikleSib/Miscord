import React, { useState, useEffect } from 'react';
import { audioProcessingService, NoiseSuppressionEngine } from '../services/audioProcessingService';
import { Label } from './ui/label';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
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
    <div className="bg-secondary border border-border rounded-lg p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Движок шумоподавления</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Выберите алгоритм шумоподавления в зависимости от ваших требований к качеству и производительности
        </p>
      </div>
      <div className="space-y-4">
        <RadioGroup value={selectedEngine} onValueChange={handleEngineChange}>
          {supportedEngines.map(({ engine, supported, name }) => {
            const perf = getEnginePerformance(engine);
            const isSelected = selectedEngine === engine;

            return (
              <div
                key={engine}
                className={`relative flex items-start space-x-3 rounded-lg border p-4 transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-border/80 bg-background'
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
                    className={`flex items-center gap-2 font-medium text-foreground ${
                      !supported ? 'cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    {getEngineIcon(engine)}
                    {name}
                    {!supported && (
                      <span className="text-xs text-destructive">(Не поддерживается)</span>
                    )}
                  </Label>

                  <p className="text-sm text-muted-foreground">{getEngineDescription(engine)}</p>

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">CPU:</span>{' '}
                      <span className="font-medium text-foreground">{perf.cpu}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Задержка:</span>{' '}
                      <span className="font-medium text-foreground">{perf.latency}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Качество:</span>{' '}
                      <span className="font-medium text-foreground">{perf.quality}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </RadioGroup>

        

        {selectedEngine === 'rnnoise' && (
          <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-green-200">
                <strong>RNNoise</strong> - проверенный алгоритм, который обеспечивает хороший баланс между качеством и производительностью.
                Подходит для большинства случаев использования.
              </div>
            </div>
          </div>
        )}

        {selectedEngine === 'browser' && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-yellow-200">
                <strong>Браузерные фильтры</strong> используют встроенные возможности браузера.
                Это самый легковесный вариант, но качество может быть ниже чем у специализированных алгоритмов.
              </div>
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            💡 <strong>Совет:</strong> Начните с браузерных фильтров и переключайтесь на более продвинутые движки только если нужно лучшее качество.
            Изменение движка требует переподключения к голосовому каналу.
          </p>
        </div>
      </div>
    </div>
  );
};
