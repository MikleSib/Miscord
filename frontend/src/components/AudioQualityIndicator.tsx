import React from 'react';
import { Wifi, WifiOff, Mic, MicOff, Zap } from 'lucide-react';

interface AudioQualityIndicatorProps {
  isConnected: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  vadEnabled: boolean;
  noiseSuppressionEnabled: boolean;
  advancedNoiseSuppressionEnabled: boolean;
  signalQuality?: number; // 0-100
}

export const AudioQualityIndicator: React.FC<AudioQualityIndicatorProps> = ({
  isConnected,
  isSpeaking,
  isMuted,
  vadEnabled,
  noiseSuppressionEnabled,
  advancedNoiseSuppressionEnabled,
  signalQuality = 100
}) => {
  const getQualityColor = (quality: number) => {
    if (quality >= 80) return 'text-green-400';
    if (quality >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getQualityText = (quality: number) => {
    if (quality >= 80) return 'Отличное';
    if (quality >= 50) return 'Хорошее';
    return 'Плохое';
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-[#2b2d31] rounded-lg">
      {/* Статус подключения */}
      <div className="flex items-center gap-1">
        {isConnected ? (
          <Wifi className={`w-4 h-4 ${getQualityColor(signalQuality)}`} />
        ) : (
          <WifiOff className="w-4 h-4 text-gray-500" />
        )}
      </div>

      {/* Разделитель */}
      <div className="w-px h-4 bg-[#4e4f56]" />

      {/* Индикаторы функций */}
      <div className="flex items-center gap-2 text-xs">
        {/* VAD индикатор */}
        {vadEnabled && (
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded ${
              isSpeaking && !isMuted ? 'bg-green-500/20 text-green-400' : 'bg-[#36373e] text-[#949ba4]'
            }`}
            title="Детекция голоса"
          >
            <Mic className="w-3 h-3" />
            <span>VAD</span>
          </div>
        )}

        {/* Шумоподавление */}
        {noiseSuppressionEnabled && (
          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded ${
              advancedNoiseSuppressionEnabled
                ? 'bg-purple-500/20 text-purple-400'
                : 'bg-[#36373e] text-[#949ba4]'
            }`}
            title={
              advancedNoiseSuppressionEnabled
                ? 'Продвинутое шумоподавление (Noise Gate)'
                : 'Базовое шумоподавление'
            }
          >
            <Zap className="w-3 h-3" />
            <span>{advancedNoiseSuppressionEnabled ? 'NG+' : 'NS'}</span>
          </div>
        )}
      </div>

      {/* Качество сигнала */}
      <div className="ml-auto flex items-center gap-2">
        <div className="flex flex-col items-end">
          <span className={`text-xs font-medium ${getQualityColor(signalQuality)}`}>
            {getQualityText(signalQuality)}
          </span>
          <div className="flex items-center gap-0.5 mt-0.5">
            {[1, 2, 3, 4].map((bar) => (
              <div
                key={bar}
                className={`w-1 h-${bar * 2} rounded-full transition-all ${
                  signalQuality >= bar * 25
                    ? getQualityColor(signalQuality)
                    : 'bg-[#4e4f56]'
                }`}
                style={{ height: `${bar * 3}px` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}; 