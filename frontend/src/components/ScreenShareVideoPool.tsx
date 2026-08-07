'use client';

import { SCREEN_SHARE_VIDEO_POOL_ID } from '../lib/screenShareVideo';

/** Скрытый контейнер для WebRTC-видео — всегда в DOM, пока открыт сервер. */
export function ScreenShareVideoPool() {
  return (
    <div
      id={SCREEN_SHARE_VIDEO_POOL_ID}
      className="pointer-events-none fixed overflow-hidden"
      style={{
        left: -9999,
        top: 0,
        width: 640,
        height: 360,
        opacity: 0.01,
        visibility: 'hidden',
      }}
      aria-hidden
    />
  );
}
