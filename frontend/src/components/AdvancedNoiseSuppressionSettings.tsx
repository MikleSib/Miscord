'use client'

import React from 'react';
import { useNoiseSuppressionStore } from '@/store/noiseSuppressionStore';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';

const AdvancedNoiseSuppressionSettings: React.FC = () => {
  const {
    isEnabled,
    setEnabled,
    settings,
    setMode,
    setSensitivity,
    setVadThreshold,
    micLevel,
    stats,
    isSupported,
  } = useNoiseSuppressionStore();

  if (!isSupported) {
    return (
      <div className="p-4 bg-gray-800 text-white rounded-lg">
        <p>Ваш браузер не поддерживает продвинутое шумоподавление.</p>
      </div>
    );
  }
  
  const micLevelPercentage = Math.max(0, 100 + micLevel);

  return (
    <div className="p-6 bg-gray-800 text-white rounded-lg space-y-6">
      <div className="flex items-center justify-between">
        <Label htmlFor="ns-enable" className="text-lg font-medium">
          Шумоподавление
        </Label>
        <Switch
          id="ns-enable"
          checked={isEnabled}
          onCheckedChange={setEnabled}
        />
      </div>

      <Separator />

      {isEnabled && (
        <>
          <div>
            <Label className="text-base font-medium">Режим</Label>
            <p className="text-sm text-gray-400 mb-2">
              Выберите, насколько агрессивно подавлять шум.
            </p>
            <RadioGroup
              value={settings.mode}
              onValueChange={(value: 'gentle' | 'balanced' | 'aggressive') => setMode(value)}
              className="flex space-x-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="gentle" id="mode-gentle" />
                <Label htmlFor="mode-gentle">Мягкий</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="balanced" id="mode-balanced" />
                <Label htmlFor="mode-balanced">Сбалансированный</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="aggressive" id="mode-aggressive" />
                <Label htmlFor="mode-aggressive">Агрессивный</Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label htmlFor="sensitivity-slider" className="text-base font-medium">
              Чувствительность ({settings.sensitivity}%)
            </Label>
            <p className="text-sm text-gray-400 mb-2">
              Определяет, что считать шумом. Высокие значения могут искажать голос.
            </p>
            <Slider
              id="sensitivity-slider"
              min={0}
              max={100}
              step={1}
              value={[settings.sensitivity]}
              onValueChange={(value) => setSensitivity(value[0])}
            />
          </div>

          <Separator />
          
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="vad-threshold-slider" className="text-base font-medium">
                Чувствительность микрофона
              </Label>
              <span className="text-sm font-mono text-gray-300">{settings.vadThreshold} дБ</span>
            </div>
            <p className="text-sm text-gray-400 mb-3">
              Установите порог громкости для активации микрофона.
            </p>
            {/* Индикатор уровня микрофона */}
            <div className="relative w-full h-2 bg-gray-700 rounded-full mb-2">
              <div 
                className="absolute top-0 left-0 h-full bg-green-500 rounded-full transition-all duration-75"
                style={{ width: `${micLevelPercentage}%`}}
              />
              <div 
                className="absolute top-0 h-full w-1 bg-white"
                style={{ left: `${100 + settings.vadThreshold}%`}}
              />
            </div>
            
            <Slider
              id="vad-threshold-slider"
              min={-100}
              max={0}
              step={1}
              value={[settings.vadThreshold]}
              onValueChange={(value) => setVadThreshold(value[0])}
            />
          </div>

          <Separator />

          <div>
            <h3 className="text-lg font-medium mb-2">Качество в реальном времени</h3>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Оценка качества</Label>
                <span className="font-mono text-green-400">{stats.quality}%</span>
              </div>
              <div
                className="w-full bg-gray-700 rounded-full h-2.5"
                role="progressbar"
                aria-valuenow={stats.quality}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="bg-green-500 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${stats.quality}%` }}
                />
              </div>
              <div className="flex justify-between text-sm text-gray-400">
                <span>Обработано: {stats.processedFrames} кадров</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdvancedNoiseSuppressionSettings; 