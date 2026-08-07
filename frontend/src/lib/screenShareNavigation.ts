import soundService from '../services/soundService';
import voiceService from '../services/voiceService';
import { useScreenShareStore } from '../store/screenShareStore';

/** Открыть просмотр стрима: звук у зрителя + сигнал ведущему. */
export function openScreenShareView(streamerId: number, username: string): void {
  if (typeof window === 'undefined') return;

  useScreenShareStore.getState().openViewer(streamerId, username);
  void voiceService.ensureRemoteScreenShare(streamerId);

  soundService.playStreamJoinSound();
  voiceService.notifyStreamerViewerJoined(streamerId);

  window.dispatchEvent(
    new CustomEvent('open_screen_share', {
      detail: { userId: streamerId, username },
    })
  );
}
