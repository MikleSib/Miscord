import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader,
  Phone,
  Rss,
  ScreenShare,
  ScreenShareOff,
  X,
} from 'lucide-react';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useStore } from '../lib/store';
import voiceService from '../services/voiceService';
import { useNoiseSuppressionStore } from '../store/noiseSuppressionStore';
import { useVoiceProcessingSettingsStore } from '../store/voiceProcessingSettingsStore';
import { getEffectiveProcessingSettings } from '../services/voiceSettings';
import voiceSettingsController from '../services/voiceSettingsController';
import { useScreenSharePickerStore } from '../store/screenSharePickerStore';
import { Switch } from './ui/switch';
import { Tooltip } from './ui/tooltip';

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
  const [isNoisePanelOpen, setIsNoisePanelOpen] = useState(false);
  const [isNoiseSuppressionToggling, setIsNoiseSuppressionToggling] = useState(false);
  const noisePanelRef = useRef<HTMLDivElement>(null);
  const noiseSuppressionStatus = useNoiseSuppressionStore((state) => state.runtimeStatus);
  const processingProfile = useVoiceProcessingSettingsStore((state) => state.profile);
  const customProcessing = useVoiceProcessingSettingsStore((state) => state.customSettings);
  const effectiveProcessing = useMemo(
    () => getEffectiveProcessingSettings(processingProfile, customProcessing),
    [processingProfile, customProcessing],
  );
  const isNoiseOn = effectiveProcessing.noiseSuppression;
  const isMiscordAI = isNoiseOn
    && effectiveProcessing.noiseSuppressionEngine === 'miscord-ai';

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

  useEffect(() => {
    if (!isNoisePanelOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!noisePanelRef.current?.contains(event.target as Node)) {
        setIsNoisePanelOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNoisePanelOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNoisePanelOpen]);

  useEffect(() => {
    if (!currentVoiceChannelId) setIsNoisePanelOpen(false);
  }, [currentVoiceChannelId]);

  const handleToggleScreenShare = () => {
    setScreenShareError(null);
    if (isScreenSharing) {
      voiceService.stopScreenShare();
      return;
    }

    useScreenSharePickerStore.getState().open();
  };

  const handleNoiseEnabledChange = async (nextEnabled: boolean) => {
    setIsNoiseSuppressionToggling(true);
    try {
      await voiceSettingsController.updateProcessing({
        ...effectiveProcessing,
        noiseSuppression: nextEnabled,
      });
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

  const noiseButtonTitle =
    noiseSuppressionStatus === 'fallback'
      ? 'Шумоподавление: временно резервный режим'
      : isNoiseOn
        ? 'Шумоподавление включено'
        : 'Шумоподавление';

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
        <div className="user-dock__voice-utilities" ref={noisePanelRef}>
          <div className="relative">
            <Tooltip content={noiseButtonTitle} disabled={isNoisePanelOpen}>
              <button
                type="button"
                onClick={() => setIsNoisePanelOpen((open) => !open)}
                className={`user-dock__voice-levels voice-icon-button ${isNoiseOn ? 'is-active' : ''} ${
                  isNoisePanelOpen ? 'is-open' : ''
                }`}
                disabled={!isConnected || isNoiseSuppressionToggling}
                aria-label="Шумоподавление"
                aria-pressed={isNoiseOn}
                aria-expanded={isNoisePanelOpen}
              >
                {isNoiseSuppressionToggling || noiseSuppressionStatus === 'loading' ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </>
                )}
              </button>
            </Tooltip>

            {isNoisePanelOpen && (
              <div
                className="user-dock__noise-popover"
                role="dialog"
                aria-label="Шумоподавление"
              >
                <div className="user-dock__noise-popover-header">
                  <h3>Шумоподавление</h3>
                  <Switch
                    variant="brand"
                    checked={isNoiseOn}
                    disabled={!isConnected || isNoiseSuppressionToggling}
                    aria-label="Включить шумоподавление"
                    onCheckedChange={(checked) => {
                      void handleNoiseEnabledChange(checked);
                    }}
                  />
                </div>
                <p className="user-dock__noise-popover-text">
                  Miscord AI убирает клавиатуру, вентилятор и фоновый шум — друзья слышат только ваш голос.
                </p>
                {noiseSuppressionStatus === 'fallback' && (
                  <p className="user-dock__noise-popover-hint">
                    Сейчас временно используется резервный режим.
                  </p>
                )}
                <p className="user-dock__noise-popover-footer">
                  {isMiscordAI ? 'С помощью Miscord AI' : isNoiseOn ? 'Шумоподавление включено' : 'Выключено'}
                </p>
              </div>
            )}
          </div>

          <Tooltip content="Отключиться">
            <button
              type="button"
              onClick={disconnectFromVoiceChannel}
              className="voice-icon-button user-dock__disconnect"
              aria-label="Отключиться от голосового канала"
            >
              <Phone className="h-[18px] w-[18px]" />
            </button>
          </Tooltip>
        </div>
      </header>

      {(screenShareError || error) && (
        <p className="mx-2 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-300" role="alert">
          {screenShareError || error}
        </p>
      )}

      <div className="user-dock__voice-actions">
        <Tooltip content={isScreenSharing ? 'Остановить демонстрацию' : 'Демонстрация экрана'}>
          <button
            type="button"
            onClick={handleToggleScreenShare}
            className={`voice-control h-11 w-full ${isScreenSharing ? 'is-active' : ''}`}
            aria-label={isScreenSharing ? 'Остановить демонстрацию экрана' : 'Начать демонстрацию экрана'}
            aria-pressed={isScreenSharing}
            disabled={!isConnected}
          >
            {isScreenSharing ? <ScreenShareOff className="h-[18px] w-[18px]" /> : <ScreenShare className="h-[18px] w-[18px]" />}
          </button>
        </Tooltip>
      </div>
    </section>
  );
}
