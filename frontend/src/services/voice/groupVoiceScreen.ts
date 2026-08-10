import {
  getDisplayMediaVideoConstraints,
  getElectronCaptureConstraints,
  resolveQualitySettings,
} from '../../lib/screenShareQuality';
import { SCREEN_SHARE_VIDEO_POOL_ID } from '../../lib/screenShareVideo';
import { useScreenShareSettingsStore } from '../../store/screenShareSettingsStore';
import type { SfuTransport } from './sfuTransport';

export type StartScreenShareOptions = {
  sourceId?: string;
  preferDisplaySurface?: 'browser' | 'monitor' | 'window';
};

export type ScreenStartResult = {
  stream: MediaStream | null;
  cancelled: boolean;
};

interface ScreenStartContext {
  options: StartScreenShareOptions;
  transport: SfuTransport;
  isCurrent: () => boolean;
}

const stopStream = (stream: MediaStream | null): void => {
  stream?.getTracks().forEach((track) => track.stop());
};

export class GroupVoiceScreenLifecycle {
  private revision = 0;
  private starting = false;

  invalidate(): void {
    this.revision += 1;
  }

  async start(context: ScreenStartContext): Promise<ScreenStartResult> {
    if (this.starting) return { stream: null, cancelled: false };
    const revision = ++this.revision;
    this.starting = true;
    let stream: MediaStream | null = null;
    try {
      stream = await captureGroupVoiceScreen(context.options);
      if (!this.isCurrent(revision, context)) {
        stopStream(stream);
        return { stream: null, cancelled: false };
      }
      await context.transport.startScreenShare(stream);
      const videoTrack = stream.getVideoTracks()[0];
      if (!this.isCurrent(revision, context) || videoTrack?.readyState !== 'live') {
        await context.transport.stopScreenShare().catch(() => undefined);
        stopStream(stream);
        return { stream: null, cancelled: false };
      }
      return { stream, cancelled: false };
    } catch (error) {
      stopStream(stream);
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        return { stream: null, cancelled: true };
      }
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private isCurrent(revision: number, context: ScreenStartContext): boolean {
    return revision === this.revision && context.isCurrent();
  }
}

export async function captureGroupVoiceScreen(options: StartScreenShareOptions): Promise<MediaStream> {
  const settings = useScreenShareSettingsStore.getState();
  const resolved = resolveQualitySettings(settings);
  const electron = typeof window !== 'undefined' && !!window.electronAPI?.getDesktopSources;
  let stream: MediaStream;
  if (electron) {
    if (!options.sourceId) throw new Error('Не выбран источник демонстрации.');
    const constraints = (audio: boolean): MediaStreamConstraints => ({
      audio: audio && !settings.muteStreamAudio
        ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: options.sourceId } } as MediaTrackConstraints
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: options.sourceId,
          ...getElectronCaptureConstraints(resolved),
        },
      } as MediaTrackConstraints,
    });
    try { stream = await navigator.mediaDevices.getUserMedia(constraints(true)); }
    catch { stream = await navigator.mediaDevices.getUserMedia(constraints(false)); }
  } else {
    const video = getDisplayMediaVideoConstraints(resolved) as MediaTrackConstraints & { displaySurface?: string };
    if (options.preferDisplaySurface) video.displaySurface = options.preferDisplaySurface;
    stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: !settings.muteStreamAudio });
  }
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stopStream(stream);
    throw new Error('Источник не создал видеодорожку.');
  }
  track.contentHint = resolved.contentHint;
  return stream;
}

export function attachScreenMedia(
  tracksByUser: Map<number, Map<string, MediaStreamTrack>>,
  userId: number,
  stream: MediaStream,
): void {
  const tracks = tracksByUser.get(userId) ?? new Map<string, MediaStreamTrack>();
  for (const track of stream.getTracks()) tracks.set(track.kind, track);
  tracksByUser.set(userId, tracks);
  let video = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement | null;
  if (!video) {
    video = document.createElement('video');
    video.id = `remote-video-${userId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.defaultMuted = true;
    document.getElementById(SCREEN_SHARE_VIDEO_POOL_ID)?.appendChild(video);
  }
  video.srcObject = new MediaStream([...tracks.values()]);
  void video.play().catch(() => undefined);
}

export function removeScreenMedia(
  tracksByUser: Map<number, Map<string, MediaStreamTrack>>,
  userId: number,
): void {
  tracksByUser.delete(userId);
  const video = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement | null;
  if (video) { video.srcObject = null; video.remove(); }
}
