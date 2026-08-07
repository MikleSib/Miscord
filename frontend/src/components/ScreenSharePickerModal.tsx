'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Monitor, RefreshCw, Smartphone, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  filterSourcesByTab,
  isElectronCaptureAvailable,
  mapPickerTabToDisplaySurface,
  ScreenShareCaptureSource,
  ScreenSharePickerTab,
} from '../lib/screenShareCapture';
import {
  formatStreamQualityLabel,
  resolveQualitySettings,
} from '../lib/screenShareQuality';
import { useScreenSharePickerStore } from '../store/screenSharePickerStore';
import { useScreenShareSettingsStore } from '../store/screenShareSettingsStore';
import { StreamModeMenu } from './StreamModeMenu';
import voiceService from '../services/voiceService';

const TABS: { id: ScreenSharePickerTab; label: string }[] = [
  { id: 'applications', label: 'Приложения' },
  { id: 'screen', label: 'Весь экран' },
  { id: 'devices', label: 'Устройства' },
];

const PRESET_LABELS = {
  games: 'Игры',
  screen: 'Демонстрация экрана',
  custom: 'Пользовательские',
} as const;

const BROWSER_PLACEHOLDERS: Record<
  ScreenSharePickerTab,
  { title: string; subtitle: string }
> = {
  applications: {
    title: 'Окно приложения',
    subtitle: 'Браузер покажет список открытых окон',
  },
  screen: {
    title: 'Весь экран',
    subtitle: 'Браузер покажет доступные мониторы',
  },
  devices: {
    title: 'Вкладка браузера',
    subtitle: 'Браузер предложит выбрать вкладку',
  },
};

function SourceCard({
  source,
  selected,
  onSelect,
}: {
  source: ScreenShareCaptureSource;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border bg-[#2b2d31] text-left transition-all hover:border-[#5865f2]/70',
        selected ? 'border-[#5865f2] ring-2 ring-[#5865f2]/40' : 'border-[#3e3f45]'
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[#1e1f22]">
        {source.thumbnailDataURL ? (
          <img
            src={source.thumbnailDataURL}
            alt={source.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[#949ba4]">
            <Monitor className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-2 py-2">
        {source.appIconDataURL ? (
          <img src={source.appIconDataURL} alt="" className="h-4 w-4 rounded-sm" />
        ) : (
          <Monitor className="h-4 w-4 shrink-0 text-[#949ba4]" />
        )}
        <span className="truncate text-xs text-[#dbdee1]">{source.name}</span>
      </div>
    </button>
  );
}

export function ScreenSharePickerModal() {
  const { isOpen, close } = useScreenSharePickerStore();
  const { preset, resolution, fps, muteStreamAudio } = useScreenShareSettingsStore();

  const [activeTab, setActiveTab] = useState<ScreenSharePickerTab>('applications');
  const [sources, setSources] = useState<ScreenShareCaptureSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isElectron = isElectronCaptureAvailable();
  const resolvedQuality = resolveQualitySettings({
    preset,
    resolution,
    fps,
    muteStreamAudio,
  });

  const visibleSources = useMemo(
    () => filterSourcesByTab(sources, activeTab),
    [sources, activeTab]
  );

  const loadSources = useCallback(async () => {
    if (!isElectron) {
      setSources([]);
      return;
    }

    setIsLoadingSources(true);
    setError(null);
    try {
      const list = await window.electronAPI!.getDesktopSources!({
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
      });
      setSources(list as ScreenShareCaptureSource[]);
    } catch (loadError) {
      console.error('Не удалось загрузить источники захвата:', loadError);
      setError('Не удалось загрузить список окон и экранов');
      setSources([]);
    } finally {
      setIsLoadingSources(false);
    }
  }, [isElectron]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('applications');
    setSelectedSourceId(null);
    setError(null);
    void loadSources();
  }, [isOpen, loadSources]);

  useEffect(() => {
    setSelectedSourceId(null);
  }, [activeTab]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  const canShare = isElectron ? Boolean(selectedSourceId) : true;

  const handleShare = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const started = await voiceService.startScreenShare({
        sourceId: selectedSourceId ?? undefined,
        preferDisplaySurface: mapPickerTabToDisplaySurface(activeTab),
      });

      if (!started) {
        if (voiceService.wasLastScreenShareStartCancelled()) {
          close();
          return;
        }
        setError('Не удалось начать трансляцию. Проверьте разрешения браузера.');
        return;
      }

      close();
    } catch (shareError) {
      console.error(shareError);
      setError('Не удалось начать трансляцию');
    } finally {
      setIsStarting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[min(720px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#3e3f45] bg-[#232428] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#3e3f45] px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-[#f2f3f5]">Выберите, что транслировать</h2>
            <p className="text-xs text-[#949ba4]">
              {isElectron
                ? 'Выберите окно или экран, затем нажмите «Передавать»'
                : 'После нажатия «Передавать» браузер попросит выбрать источник'}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-2 text-[#b5bac1] hover:bg-[#3a3c43] hover:text-white"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-[#3e3f45] px-3 pt-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-t-lg px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-[#2b2d31] text-white'
                  : 'text-[#949ba4] hover:text-[#dbdee1]'
              )}
            >
              {tab.label}
            </button>
          ))}
          {isElectron && (
            <button
              type="button"
              onClick={() => void loadSources()}
              className="ml-auto mb-1 rounded-md p-2 text-[#949ba4] hover:bg-[#3a3c43] hover:text-white"
              title="Обновить список"
            >
              <RefreshCw className={cn('h-4 w-4', isLoadingSources && 'animate-spin')} />
            </button>
          )}
        </div>

        <div className="min-h-[320px] flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {isLoadingSources ? (
            <div className="flex h-[280px] items-center justify-center text-[#949ba4]">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Загрузка источников...
            </div>
          ) : isElectron ? (
            visibleSources.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {visibleSources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    selected={selectedSourceId === source.id}
                    onSelect={() => setSelectedSourceId(source.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-[280px] flex-col items-center justify-center text-center text-[#949ba4]">
                <Monitor className="mb-3 h-10 w-10 opacity-60" />
                <p>Нет доступных источников в этой категории</p>
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={() => setSelectedSourceId('browser-placeholder')}
              className={cn(
                'mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-xl border bg-[#2b2d31] text-left transition-all hover:border-[#5865f2]/70',
                selectedSourceId
                  ? 'border-[#5865f2] ring-2 ring-[#5865f2]/40'
                  : 'border-[#3e3f45]'
              )}
            >
              <div className="flex aspect-video items-center justify-center bg-[#1e1f22]">
                {activeTab === 'devices' ? (
                  <Smartphone className="h-12 w-12 text-[#5865f2]" />
                ) : (
                  <Monitor className="h-12 w-12 text-[#5865f2]" />
                )}
              </div>
              <div className="px-4 py-3">
                <p className="font-medium text-[#f2f3f5]">
                  {BROWSER_PLACEHOLDERS[activeTab].title}
                </p>
                <p className="mt-1 text-sm text-[#949ba4]">
                  {BROWSER_PLACEHOLDERS[activeTab].subtitle}
                </p>
              </div>
            </button>
          )}
        </div>

        <div className="relative z-10 flex items-center justify-between gap-3 overflow-visible border-t border-[#3e3f45] bg-[#2b2d31] px-4 py-3">
          <div className="flex items-center gap-3 overflow-visible">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#f2f3f5]">
                {PRESET_LABELS[preset]}
              </p>
              <p className="truncate text-xs text-[#949ba4]">
                {formatStreamQualityLabel(resolvedQuality)}
              </p>
            </div>
            <StreamModeMenu disabled={isStarting} placement="top-left" />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md px-4 py-2 text-sm text-[#dbdee1] hover:bg-[#3a3c43]"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={!canShare || isStarting}
              onClick={() => void handleShare()}
              className="rounded-md bg-[#5865f2] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStarting ? 'Запуск...' : 'Передавать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
