'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openScreenShareView } from '../lib/screenShareNavigation';
import { attachStreamToPreviewVideo, isStreamVideoReady } from '../lib/screenShareVideo';
import voiceService from '../services/voiceService';

type StreamHoverPreviewProps = {
  userId: number;
  username: string;
  anchorRect: DOMRect;
  isSelf: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

export function StreamHoverPreview({
  userId,
  username,
  anchorRect,
  isSelf,
  onMouseEnter,
  onMouseLeave,
}: StreamHoverPreviewProps) {
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  useEffect(() => {
    const previewVideo = previewVideoRef.current;
    if (!previewVideo) return;

    void voiceService.ensureRemoteScreenShare(userId);

    const attachStream = () => {
      if (attachStreamToPreviewVideo(userId, previewVideo)) {
        if (isStreamVideoReady(userId)) {
          setIsConnecting(false);
        }
        return;
      }
      setIsConnecting(true);
      void voiceService.ensureRemoteScreenShare(userId);
    };

    attachStream();
    const timer = window.setInterval(attachStream, 500);
    return () => {
      window.clearInterval(timer);
      previewVideo.srcObject = null;
    };
  }, [userId]);

  const handleOpen = () => {
    openScreenShareView(userId, username);
  };

  const top = Math.max(12, Math.min(anchorRect.top, window.innerHeight - 320));
  const left = anchorRect.right + 12;

  return (
    <div
      className="fixed z-[120] w-[min(22rem,calc(100vw-var(--left-dock-width)-2rem))] overflow-hidden rounded-xl border border-[#3e3f45] bg-[#232428] shadow-2xl"
      style={{ top, left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-xs font-medium text-[#b5bac1]">Сейчас стримит</span>
        <span className="rounded bg-[#da373c] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          В эфире
        </span>
      </div>

      <button
        type="button"
        className="group relative block w-full cursor-pointer border-0 bg-black p-0"
        onClick={handleOpen}
        aria-label={isSelf ? 'Открыть свой стрим' : `Смотреть стрим ${username}`}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          <video
            ref={previewVideoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-contain"
          />
          {isConnecting && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-[#b5bac1]">
              Подключение к стриму...
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          {isSelf && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-semibold text-white drop-shadow-lg">Вы стримите!</span>
            </div>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          'flex w-full items-center justify-center gap-2 border-t border-[#3e3f45] px-3 py-2.5',
          'text-sm font-medium text-[#dbdee1] transition-colors hover:bg-[#2b2d31]'
        )}
      >
        <Monitor className="h-4 w-4 text-[#b5bac1]" />
        {isSelf ? 'Вы стримите!' : `Смотреть — ${username}`}
      </button>
    </div>
  );
}
