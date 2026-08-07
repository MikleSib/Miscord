import React, { useEffect } from 'react';
import { X, Maximize2 } from 'lucide-react';
import {
  mountStreamVideoToViewer,
  mountStreamVideosToPool,
} from '../lib/screenShareVideo';
import voiceService from '../services/voiceService';

interface ScreenShareViewerProps {
  isVisible: boolean;
  onClose: () => void;
  activeStreamerId: number | null;
  sharingUsers: Array<{
    userId: number;
    username: string;
    avatar_url?: string;
  }>;
  currentChannelName: string;
  showMemberSidebar: boolean;
}

export function ScreenShareViewer({
  isVisible,
  onClose,
  activeStreamerId,
  sharingUsers,
  currentChannelName,
  showMemberSidebar,
}: ScreenShareViewerProps) {
  const selectedUser =
    sharingUsers.find((user) => user.userId === activeStreamerId) ??
    (activeStreamerId
      ? { userId: activeStreamerId, username: `User ${activeStreamerId}` }
      : null) ??
    sharingUsers[0] ??
    null;

  useEffect(() => {
    if (!isVisible || !selectedUser) {
      mountStreamVideosToPool();
      return;
    }

    mountStreamVideoToViewer(selectedUser.userId);
  }, [isVisible, selectedUser?.userId]);

  if (!isVisible || !selectedUser) {
    return null;
  }

  const handleFullscreen = () => {
    const container = document.getElementById('screen-share-container-chat');
    if (!container) return;

    if (!document.fullscreenElement) {
      void container.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  };

  const qualityLabel = voiceService.getStreamQualityLabel();

  return (
    <div
      className="fixed bottom-0 top-0 z-[45] bg-black"
      style={{
        left: 'var(--left-dock-width)',
        right: showMemberSidebar ? 'var(--member-sidebar-width)' : 0,
      }}
    >
      <div className="absolute inset-x-0 top-0 z-10 border-b border-[#3e3f45] bg-black/85 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#da373c]" />
              <span className="truncate font-medium text-white">
                Экран {selectedUser.username}
              </span>
            </div>
            <span className="hidden text-sm text-[#b5bac1] sm:inline">
              {qualityLabel}
            </span>
            <span className="rounded bg-[#da373c] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              В эфире
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleFullscreen}
              className="rounded p-2 text-[#b5bac1] transition-colors hover:bg-[#2b2d31] hover:text-white"
              title="Полноэкранный режим"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-2 text-[#b5bac1] transition-colors hover:bg-[#2b2d31] hover:text-white"
              title="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex h-full pt-[3.25rem]">
        <div
          id="screen-share-container-chat"
          className="relative flex h-full w-full items-center justify-center bg-black"
        >
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[#949ba4]">
            <p>Загрузка видео от {selectedUser.username}...</p>
          </div>
        </div>
      </div>
    </div>
  );
}
