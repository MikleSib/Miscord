'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatPresetDescription,
  formatStreamQualityLabel,
  RESOLUTION_DIMENSIONS,
  resolveQualitySettings,
  StreamFps,
  StreamPreset,
  StreamResolution,
} from '../lib/screenShareQuality';
import { useScreenShareSettingsStore } from '../store/screenShareSettingsStore';
import voiceService from '../services/voiceService';

type Submenu = 'resolution' | 'fps' | null;

const PRESETS: { id: StreamPreset; title: string }[] = [
  { id: 'games', title: 'Игры' },
  { id: 'screen', title: 'Демонстрация экрана' },
  { id: 'custom', title: 'Пользовательские' },
];

const RESOLUTIONS: { id: StreamResolution; label: string }[] = [
  { id: '720', label: '720p' },
  { id: '1080', label: '1080p' },
  { id: '1440', label: '1440p' },
  { id: 'source', label: 'Источник' },
];

const FPS_OPTIONS: StreamFps[] = [15, 30, 60];

function RadioRow({
  checked,
  title,
  description,
  onClick,
}: {
  checked: boolean;
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[#3a3c43]"
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-[#5865f2] bg-[#5865f2]' : 'border-[#949ba4]'
        )}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[#f2f3f5]">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-[#949ba4]">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

export function StreamModeMenu({
  disabled,
  placement = 'top-left',
}: {
  disabled?: boolean;
  placement?: 'top-left' | 'top-right';
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const MENU_WIDTH = 288;
  const MENU_GAP = 8;
  const VIEWPORT_PADDING = 12;

  const {
    preset,
    resolution,
    fps,
    muteStreamAudio,
    setPreset,
    setResolution,
    setFps,
    setMuteStreamAudio,
  } = useScreenShareSettingsStore();

  const resolved = resolveQualitySettings({ preset, resolution, fps, muteStreamAudio });

  const updateMenuPosition = () => {
    const anchor = rootRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 420;

    let left =
      placement === 'top-right'
        ? rect.right - MENU_WIDTH
        : rect.left;

    left = Math.max(
      VIEWPORT_PADDING,
      Math.min(left, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING)
    );

    let top = rect.top - menuHeight - MENU_GAP;
    if (top < VIEWPORT_PADDING) {
      top = rect.bottom + MENU_GAP;
    }

    setMenuStyle((prev) => {
      if (prev && prev.top === top && prev.left === left) {
        return prev;
      }
      return { top, left };
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }

    updateMenuPosition();
    const refineFrame = requestAnimationFrame(updateMenuPosition);

    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      cancelAnimationFrame(refineFrame);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, placement, preset, submenu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      setSubmenu(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const applyLive = () => {
    if (voiceService.getScreenSharingStatus()) {
      void voiceService.reapplyScreenShareQuality();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="voice-control h-9 w-9 shrink-0"
        disabled={disabled}
        aria-label="Режим стрима"
        title="Режим стрима"
        onClick={() => {
          setOpen((value) => !value);
          setSubmenu(null);
        }}
      >
        <Settings2 className="h-[18px] w-[18px]" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={
              menuStyle
                ? { top: menuStyle.top, left: menuStyle.left }
                : { visibility: 'hidden', top: 0, left: 0 }
            }
            className="fixed z-[250] w-72 overflow-visible rounded-lg border border-[#3e3f45] bg-[#232428] p-2 shadow-2xl"
          >
          <div className="mb-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[#949ba4]">
            Режим стрима
          </div>

          {PRESETS.map((item) => (
            <RadioRow
              key={item.id}
              checked={preset === item.id}
              title={item.title}
              description={formatPresetDescription(item.id)}
              onClick={() => {
                setPreset(item.id);
                applyLive();
              }}
            />
          ))}

          {preset === 'custom' && (
            <div className="mt-1 space-y-0.5 border-t border-[#3e3f45] pt-1">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm text-[#dbdee1] hover:bg-[#3a3c43]"
                onClick={() => setSubmenu(submenu === 'resolution' ? null : 'resolution')}
              >
                <span>Разрешение экрана</span>
                <span className="flex items-center gap-1 text-xs text-[#949ba4]">
                  {resolution === 'source'
                    ? 'Источник'
                    : RESOLUTION_DIMENSIONS[resolution].label}
                  <ChevronRight className="h-4 w-4" />
                </span>
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm text-[#dbdee1] hover:bg-[#3a3c43]"
                onClick={() => setSubmenu(submenu === 'fps' ? null : 'fps')}
              >
                <span>Частота кадров</span>
                <span className="flex items-center gap-1 text-xs text-[#949ba4]">
                  {fps} fps
                  <ChevronRight className="h-4 w-4" />
                </span>
              </button>
            </div>
          )}

          <label className="mt-1 flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm text-[#dbdee1] hover:bg-[#3a3c43]">
            <span>Заглушить аудио стрима</span>
            <input
              type="checkbox"
              checked={muteStreamAudio}
              onChange={(event) => {
                setMuteStreamAudio(event.target.checked);
                applyLive();
              }}
              className="h-4 w-4 accent-[#5865f2]"
            />
          </label>

          <div className="mt-2 border-t border-[#3e3f45] px-2 pt-2 text-xs text-[#949ba4]">
            Текущий режим: {formatStreamQualityLabel(resolved)}
          </div>

          {submenu === 'resolution' && (
            <div className="absolute left-[calc(100%+8px)] top-16 w-44 rounded-lg border border-[#3e3f45] bg-[#232428] p-2 shadow-2xl">
              <div className="mb-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[#949ba4]">
                Разрешение экрана
              </div>
              {RESOLUTIONS.map((item) => (
                <RadioRow
                  key={item.id}
                  checked={resolution === item.id}
                  title={item.label}
                  onClick={() => {
                    setResolution(item.id);
                    setSubmenu(null);
                    applyLive();
                  }}
                />
              ))}
            </div>
          )}

          {submenu === 'fps' && (
            <div className="absolute left-[calc(100%+8px)] top-28 w-36 rounded-lg border border-[#3e3f45] bg-[#232428] p-2 shadow-2xl">
              <div className="mb-1 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-[#949ba4]">
                Частота кадров
              </div>
              {FPS_OPTIONS.map((value) => (
                <RadioRow
                  key={value}
                  checked={fps === value}
                  title={`${value} fps`}
                  onClick={() => {
                    setFps(value);
                    setSubmenu(null);
                    applyLive();
                  }}
                />
              ))}
            </div>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}
