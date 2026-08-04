import React, { useEffect, useMemo, useState } from 'react';
import {
  Loader,
  Phone,
  Rss,
  ScreenShare,
  ScreenShareOff,
  Shapes,
  SunMedium,
  VideoOff,
  X,
} from 'lucide-react';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useStore } from '../lib/store';
import voiceService from '../services/voiceService';
import { audioProcessingService } from '../services/audioProcessingService';
import { useNoiseSuppressionStore } from '../store/noiseSuppressionStore';

export function VoiceConnectionPanel() {
  const {
    isConnected,
    isConnecting,
    currentVoiceChannelId,
    error,
    disconnectFromVoiceChannel,
    setError,
  } = useVoiceStore();
  const { currentServer } = useStore();
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [isNoiseSuppressionToggling, setIsNoiseSuppressionToggling] = useState(false);
  const noiseSuppressionEnabled = useNoiseSuppressionStore((state) => state.enabled);
  const noiseSuppressionEngine = useNoiseSuppressionStore((state) => state.engine);
  const noiseSuppressionStatus = useNoiseSuppressionStore((state) => state.runtimeStatus);
  const setNoiseSuppressionEnabled = useNoiseSuppressionStore((state) => state.setEnabled);
  const setNoiseSuppressionEngine = useNoiseSuppressionStore((state) => state.setEngine);

  const currentChannel = useMemo(
    () =>
      currentServer?.channels.find(
        (channel: any) => Number(channel.id) === currentVoiceChannelId && channel.type === 'voice'
      ),
    [currentServer, currentVoiceChannelId]
  );

  useEffect(() => {
    const updateScreenShareStatus = () => {
      setIsScreenSharing(voiceService.getScreenSharingStatus());
    };

    updateScreenShareStatus();
    window.addEventListener('screen_share_start', updateScreenShareStatus);
    window.addEventListener('screen_share_stop', updateScreenShareStatus);
    return () => {
      window.removeEventListener('screen_share_start', updateScreenShareStatus);
      window.removeEventListener('screen_share_stop', updateScreenShareStatus);
    };
  }, []);

  const handleToggleScreenShare = async () => {
    setScreenShareError(null);
    if (isScreenSharing) {
      voiceService.stopScreenShare();
      return;
    }

    const started = await voiceService.startScreenShare();
    if (!started) {
      setScreenShareError('Не удалось начать демонстрацию. Проверьте разрешение на захват экрана.');
    }
  };

  const handleToggleNoiseSuppression = async () => {
    const isMiscordAISelected =
      noiseSuppressionEnabled && noiseSuppressionEngine === 'miscord-ai';
    const nextEnabled = !isMiscordAISelected;

    setIsNoiseSuppressionToggling(true);
    setNoiseSuppressionEngine('miscord-ai');
    setNoiseSuppressionEnabled(nextEnabled);
    try {
      await audioProcessingService.setNoiseSuppression(nextEnabled, 'miscord-ai');
    } finally {
      setIsNoiseSuppressionToggling(false);
    }
  };

  if (!currentVoiceChannelId && error) {
    return (
      <div className="user-dock__voice user-dock__voice--error" role="alert">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Голосовое соединение прервано</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{error}</p>
        </div>
        <button
          type="button"
          className="voice-control"
          onClick={() => setError(null)}
          aria-label="Закрыть сообщение"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (!currentVoiceChannelId) return null;

  const statusTitle = isConnected
    ? 'Голосовая связь подключена'
    : isConnecting
      ? 'Подключение...'
      : 'Нет соединения';

  const channelLabel = currentChannel?.name || `Канал ${currentVoiceChannelId}`;
  const serverLabel = currentServer?.name || 'Сервер';

  return (
    <section className="user-dock__voice" aria-label="Управление голосовым каналом">
      <header className="user-dock__voice-header">
        <div className="user-dock__voice-status">
          <div className={`user-dock__signal ${isConnected ? 'is-online' : isConnecting ? 'is-connecting' : 'is-offline'}`}>
            {isConnecting ? <Loader className="h-[18px] w-[18px] animate-spin" /> : <Rss className="h-[18px] w-[18px]" />}
          </div>
          <div className="min-w-0">
            <p className={`user-dock__voice-title truncate ${isConnected ? 'is-connected' : ''}`}>
              {statusTitle}
            </p>
            <p className="user-dock__voice-subtitle truncate">
              {channelLabel} / {serverLabel}
            </p>
          </div>
        </div>
        <div className="user-dock__voice-utilities">
          <span className="user-dock__voice-levels" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <button
          type="button"
          onClick={disconnectFromVoiceChannel}
          className="voice-icon-button user-dock__disconnect"
          aria-label="Отключиться от голосового канала"
          title="Отключиться"
        >
            <Phone className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      {(screenShareError || error) && (
        <p className="mx-2 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-300" role="alert">
          {screenShareError || error}
        </p>
      )}

      <div className="user-dock__voice-actions">
        <button type="button" className="voice-control h-9 flex-1" disabled aria-label="Камера пока недоступна" title="Камера скоро">
          <VideoOff className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={handleToggleScreenShare}
          className={`voice-control h-9 flex-1 ${isScreenSharing ? 'is-active' : ''}`}
          aria-label={isScreenSharing ? 'Остановить демонстрацию экрана' : 'Начать демонстрацию экрана'}
          aria-pressed={isScreenSharing}
          disabled={!isConnected}
          title={isScreenSharing ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
        >
          {isScreenSharing ? <ScreenShareOff className="h-[18px] w-[18px]" /> : <ScreenShare className="h-[18px] w-[18px]" />}
        </button>
        <button type="button" className="voice-control h-9 flex-1" disabled aria-label="Активности пока недоступны" title="Активности скоро">
          <Shapes className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={handleToggleNoiseSuppression}
          className={`voice-control ${
            noiseSuppressionEnabled && noiseSuppressionEngine === 'miscord-ai' ? 'is-active' : ''
          }`}
          disabled={!isConnected || isNoiseSuppressionToggling}
          aria-label={
            noiseSuppressionEnabled && noiseSuppressionEngine === 'miscord-ai'
              ? 'Выключить Miscord AI'
              : 'Включить Miscord AI'
          }
          aria-pressed={noiseSuppressionEnabled && noiseSuppressionEngine === 'miscord-ai'}
          title={
            noiseSuppressionStatus === 'fallback'
              ? 'Miscord AI: временно используется резервный режим'
              : 'Miscord AI: шумоподавление'
          }
        >
          {isNoiseSuppressionToggling || noiseSuppressionStatus === 'loading' ? (
            <Loader className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <SunMedium className="h-[19px] w-[19px]" />
          )}
        </button>
      </div>
    </section>
  );
}
