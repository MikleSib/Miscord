import React, { useEffect, useState } from 'react';
import { audioProcessingService } from '../services/audioProcessingService';

interface VoiceActivityIndicatorProps {
  isActive?: boolean;
  isMuted?: boolean;
  size?: 'small' | 'medium' | 'large';
}

export const VoiceActivityIndicator: React.FC<VoiceActivityIndicatorProps> = ({
  isActive = false,
  isMuted = false,
  size = 'medium'
}) => {
  const [volume, setVolume] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    // Подписываемся на изменения громкости
    audioProcessingService.setOnVolumeChange((vol) => {
      setVolume(vol);
    });

    // Подписываемся на детекцию речи
    audioProcessingService.setOnSpeechStart(() => {
      setIsSpeaking(true);
    });

    audioProcessingService.setOnSpeechEnd(() => {
      setIsSpeaking(false);
    });
  }, []);

  const sizeClasses = {
    small: 'w-6 h-6',
    medium: 'w-8 h-8',
    large: 'w-10 h-10'
  };

  const barSizeClasses = {
    small: 'w-1',
    medium: 'w-1.5',
    large: 'w-2'
  };

  if (!isActive || isMuted) {
    return (
      <div className={`${sizeClasses[size]} flex items-center justify-center opacity-50`}>
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 11C19 15.4183 15.4183 19 11 19M5 11C5 7.134 7.13401 4 11 4M11 4V11M11 4C14.866 4 18 7.13401 18 11M11 19V11M11 19C6.58172 19 3 15.4183 3 11" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"/>
          {isMuted && (
            <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          )}
        </svg>
      </div>
    );
  }

  return (
    <div className={`${sizeClasses[size]} flex items-center justify-center gap-0.5`}>
      {[0.3, 0.6, 1, 0.6, 0.3].map((multiplier, index) => {
        const height = Math.min(100, volume * multiplier * 150);
        const isActive = height > 10;
        
        return (
          <div
            key={index}
            className={`${barSizeClasses[size]} bg-white rounded-full transition-all duration-100 ${
              isActive ? 'opacity-100' : 'opacity-30'
            }`}
            style={{
              height: `${Math.max(20, height)}%`,
              backgroundColor: isSpeaking ? '#10b981' : '#ffffff'
            }}
          />
        );
      })}
    </div>
  );
}; 