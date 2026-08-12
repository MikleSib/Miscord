'use client';

import { useEffect, useState } from 'react';
import { useVoiceStore } from '../../store/slices/voiceSlice';

export interface ScreenShareToastItem {
  id: string;
  userId: number;
  username: string;
}

interface ScreenShareStartDetail {
  user_id: number | string;
  username?: string;
  display_name?: string;
  voice_channel_id?: number | string;
}

export function useScreenShareToasts(authUserId?: number) {
  const [items, setItems] = useState<ScreenShareToastItem[]>([]);

  useEffect(() => {
    const handleScreenShareStart = (event: Event) => {
      const detail = (event as CustomEvent<ScreenShareStartDetail>).detail;
      const streamerId = Number(detail.user_id);
      const streamerChannelId = Number(detail.voice_channel_id);
      const myVoiceChannelId = useVoiceStore.getState().currentVoiceChannelId;

      if (
        !Number.isFinite(streamerId) ||
        streamerId === authUserId ||
        myVoiceChannelId == null ||
        !Number.isFinite(streamerChannelId) ||
        streamerChannelId !== myVoiceChannelId
      ) {
        return;
      }

      const username =
        detail.display_name?.trim() ||
        detail.username?.trim() ||
        `User ${streamerId}`;

      setItems((current) => [
        ...current.filter((item) => item.userId !== streamerId),
        { id: `${streamerId}-${Date.now()}`, userId: streamerId, username },
      ]);
    };

    window.addEventListener('screen_share_start', handleScreenShareStart);
    return () => window.removeEventListener('screen_share_start', handleScreenShareStart);
  }, [authUserId]);

  return {
    items,
    dismiss: (id: string) => setItems((current) => current.filter((item) => item.id !== id)),
    dismissUser: (userId: number) => setItems((current) => current.filter((item) => item.userId !== userId)),
  };
}
