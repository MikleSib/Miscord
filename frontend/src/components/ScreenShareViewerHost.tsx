'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../lib/store';
import { useVoiceStore } from '../store/slices/voiceSlice';
import { useScreenShareStore } from '../store/screenShareStore';
import { ScreenShareViewer } from './ScreenShareViewer';

type ScreenShareViewerHostProps = {
  showMemberSidebar: boolean;
};

export function ScreenShareViewerHost({ showMemberSidebar }: ScreenShareViewerHostProps) {
  const { currentChannel, currentServer } = useStore();
  const { currentVoiceChannelId } = useVoiceStore();
  const {
    streamers: sharingUsers,
    viewerOpen: isScreenShareVisible,
    activeStreamerId,
    addStreamer,
    removeStreamer,
    openViewer,
    closeViewer,
  } = useScreenShareStore();

  const streamChannelName = useMemo(() => {
    if (currentChannel?.name) return currentChannel.name;
    if (currentVoiceChannelId && currentServer) {
      const voiceChannel = currentServer.channels.find(
        (channel) => channel.id === currentVoiceChannelId && channel.type === 'voice'
      );
      return voiceChannel?.name || 'Голосовой канал';
    }
    return 'Голосовой канал';
  }, [currentChannel?.name, currentVoiceChannelId, currentServer]);

  const lastChannelKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentChannel) return;
    const channelKey = `${currentChannel.type}:${currentChannel.id}`;
    const previousKey = lastChannelKeyRef.current;
    lastChannelKeyRef.current = channelKey;

    if (
      currentChannel.type === 'text' &&
      previousKey !== null &&
      previousKey !== channelKey
    ) {
      closeViewer();
    }
  }, [currentChannel?.id, currentChannel?.type, closeViewer]);

  useEffect(() => {
    const handleScreenShareStart = (event: Event) => {
      const { user_id, username, avatar_url } = (event as CustomEvent).detail;
      addStreamer({ userId: user_id, username, avatar_url });
    };

    const handleScreenShareStop = (event: Event) => {
      const { user_id } = (event as CustomEvent).detail;
      removeStreamer(user_id);
    };

    const handleOpenScreenShare = (event: Event) => {
      const { userId, username } = (event as CustomEvent).detail;
      openViewer(userId, username);
    };

    window.addEventListener('screen_share_start', handleScreenShareStart);
    window.addEventListener('screen_share_stop', handleScreenShareStop);
    window.addEventListener('open_screen_share', handleOpenScreenShare);

    return () => {
      window.removeEventListener('screen_share_start', handleScreenShareStart);
      window.removeEventListener('screen_share_stop', handleScreenShareStop);
      window.removeEventListener('open_screen_share', handleOpenScreenShare);
    };
  }, [addStreamer, removeStreamer, openViewer]);

  return (
    <ScreenShareViewer
      isVisible={isScreenShareVisible}
      onClose={closeViewer}
      activeStreamerId={activeStreamerId}
      sharingUsers={sharingUsers}
      currentChannelName={streamChannelName}
      showMemberSidebar={showMemberSidebar}
    />
  );
}
