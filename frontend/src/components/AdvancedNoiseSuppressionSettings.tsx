'use client'

import React, { useEffect } from 'react';
import { useNoiseSuppressionStore, NoiseSuppressionLevel } from '@/store/noiseSuppressionStore';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

// --- Icons ---
const BrainCircuit: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.1.39-1.99 1.03-2.69a3.6 3.6 0 0 1 .1-2.64s.84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.4.1 2.64.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.73c0 .27.16.58.67.5A10 10 0 0 0 22 12a10 10 0 0 0-10-10z"/>
  </svg>
);

const Zap: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
);

const Star: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
);

const Volume2: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    </svg>
);

const Waves: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 6c.6.5 1.2 1 2.5 1 1.6 0 1.7-1.2 3.2-1.5 1.5-.3 2.3.8 3.8.8 1.5 0 2.3-1.1 3.8-1.1S18 6 20 6" />
        <path d="M2 12c.6.5 1.2 1 2.5 1 1.6 0 1.7-1.2 3.2-1.5 1.5-.3 2.3.8 3.8.8 1.5 0 2.3-1.1 3.8-1.1S18 12 20 12" />
        <path d="M2 18c.6.5 1.2 1 2.5 1 1.6 0 1.7-1.2 3.2-1.5 1.5-.3 2.3.8 3.8.8 1.5 0 2.3-1.1 3.8-1.1S18 18 20 18" />
    </svg>
)
// --- End Icons ---

interface AdvancedNoiseSuppressionSettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function AdvancedNoiseSuppressionSettings({ open, onClose }: AdvancedNoiseSuppressionSettingsProps) {
  const {
    isEnabled, level, vadEnabled, sensitivity,
    support, stats,
    initialize, setEnabled, setLevel, setVadEnabled, setSensitivity
  } = useNoiseSuppressionStore();

  useEffect(() => {
    if (open) {
      initialize();
    }
  }, [open, initialize]);

  if (!open) return null;

  const qualityPercentage = Math.round(stats.quality * 100);
  const isProfessionalMode = level === 'professional';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-center items-center" onClick={onClose}>
      <div className="bg-gray-800 text-white p-6 rounded-2xl max-w-md w-full font-sans shadow-2xl border border-gray-700" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-6">
          <BrainCircuit className="h-6 w-6 mr-3 text-blue-400" />
          <h2 className="text-xl font-bold">Продвинутые настройки шумоподавления</h2>
        </div>

        <div className="bg-gray-700/50 p-4 rounded-lg mb-6">
          <h3 className="text-base font-semibold mb-3 text-gray-300">Основные настройки</h3>
          <div className="flex items-center justify-between">
            <Label htmlFor="enable-switch" className="flex items-center cursor-pointer">
              <Volume2 className="h-5 w-5 mr-3 text-gray-400" />
              <span className="text-gray-200">Включить продвинутое шумоподавление</span>
            </Label>
            <Switch id="enable-switch" checked={isEnabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <div className="bg-gray-700/50 p-4 rounded-lg mb-6">
          <h3 className="text-base font-semibold mb-4 text-gray-300">Алгоритм обработки</h3>
          <RadioGroup value={level} onValueChange={(l: NoiseSuppressionLevel) => setLevel(l)} className="space-y-3">
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="basic" id="basic" disabled={!isEnabled} />
              <Label htmlFor="basic" className={`font-normal ${isEnabled ? 'text-gray-200' : 'text-gray-500'}`}>
                Базовый
                <p className={`text-sm ${isEnabled ? 'text-gray-400' : 'text-gray-600'}`}>Встроенное подавление шума браузера</p>
              </Label>
            </div>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="advanced" id="advanced" disabled={!isEnabled} />
              <Label htmlFor="advanced" className={`font-normal ${isEnabled ? 'text-gray-200' : 'text-gray-500'}`}>
                <div className="flex items-center"><Zap className="h-5 w-5 mr-2 text-blue-400" /> Продвинутый (RNNoise)</div>
                <p className={`text-sm ${isEnabled ? 'text-gray-400' : 'text-gray-600'}`}>Машинное обучение</p>
              </Label>
            </div>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="professional" id="professional" disabled={!isEnabled} />
              <Label htmlFor="professional" className={`font-normal ${isEnabled ? 'text-gray-200' : 'text-gray-500'}`}>
                <div className="flex items-center"><Star className="h-5 w-5 mr-2 text-yellow-400" /> Профессиональный (Miscord AI)</div>
                <p className={`text-sm ${isEnabled ? 'text-gray-400' : 'text-gray-600'}`}>Наш собственный AI-алгоритм уровня Krisp!</p>
              </Label>
            </div>
          </RadioGroup>
          <div className="flex space-x-2 mt-4">
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${support.basic ? 'bg-green-600/30 text-green-300' : 'bg-red-600/30 text-red-300'}`}>Базовый: {support.basic ? 'Поддерживается' : 'Нет'}</span>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${support.advanced ? 'bg-green-600/30 text-green-300' : 'bg-red-600/30 text-red-300'}`}>Продвинутый: {support.advanced ? 'Поддерживается' : 'Нет'}</span>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${support.professional ? 'bg-green-600/30 text-green-300' : 'bg-red-600/30 text-red-300'}`}>Профи: {support.professional ? 'Поддерживается' : 'Нет'}</span>
          </div>
        </div>

        <div className={`bg-gray-700/50 p-4 rounded-lg mb-6 transition-opacity duration-300 ${isProfessionalMode ? 'opacity-100' : 'opacity-50'}`}>
          <h3 className="text-base font-semibold mb-4 text-gray-300">Детальные настройки (AI)</h3>
          <div className="mb-4">
            <Label className="block text-sm font-medium mb-2 text-gray-400">Чувствительность: {Math.round(sensitivity)}%</Label>
            <Slider min={0} max={100} step={1} value={[sensitivity]} onValueChange={(value: number[]) => setSensitivity(value[0])} disabled={!isEnabled || !isProfessionalMode} />
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>Мягкий</span>
              <span>Сбалансированный</span>
              <span>Агрессивный</span>
            </div>
          </div>
          <div className="flex items-center">
            <Checkbox id="vad" checked={vadEnabled} onCheckedChange={(checked: boolean | 'indeterminate') => setVadEnabled(Boolean(checked))} disabled={!isEnabled || !isProfessionalMode} />
            <Label htmlFor="vad" className={`ml-2 text-sm font-normal ${isEnabled && isProfessionalMode ? 'text-gray-200' : 'text-gray-500'}`}>
              Детектор голосовой активности (VAD)
            </Label>
          </div>
        </div>

        <div className="bg-green-900/40 border border-green-700/50 p-4 rounded-lg">
          <h3 className="text-base font-semibold mb-4 flex items-center text-green-300">
            <Waves className="h-5 w-5 mr-3" />
            Качество в реальном времени
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-green-400">Оценка качества</span>
              <span className="text-lg font-bold text-white">{qualityPercentage}%</span>
            </div>
            <div className="w-full bg-gray-600/50 rounded-full h-2.5">
              <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${qualityPercentage}%` }}></div>
            </div>
            <div className="flex justify-between text-xs text-gray-400 pt-1">
              <span>Обработано: {stats.processedFrames} кадров</span>
              <span>Задержка: {stats.processingTimeMs > 0 ? stats.processingTimeMs.toFixed(2) + ' мс' : 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 