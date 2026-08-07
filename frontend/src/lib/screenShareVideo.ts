export const SCREEN_SHARE_VIDEO_POOL_ID = 'screen-share-video-pool';
export const SCREEN_SHARE_VIEWER_CONTAINER_ID = 'screen-share-container-chat';

export function getStreamVideoElement(userId: number): HTMLVideoElement | null {
  return document.getElementById(`remote-video-${userId}`) as HTMLVideoElement | null;
}

export function clearNonVideoChildren(container: HTMLElement): void {
  Array.from(container.children).forEach((child) => {
    if (!(child instanceof HTMLVideoElement)) {
      child.remove();
    }
  });
}

export function mountStreamVideoToViewer(userId: number): void {
  const video = getStreamVideoElement(userId);
  const viewer = document.getElementById(SCREEN_SHARE_VIEWER_CONTAINER_ID);
  if (!video || !viewer) return;

  clearNonVideoChildren(viewer);

  viewer.querySelectorAll('video').forEach((node) => {
    node.style.display = node.id === `remote-video-${userId}` ? 'block' : 'none';
  });

  if (!viewer.contains(video)) {
    viewer.appendChild(video);
  }

  void video.play().catch(() => {});
}

export function mountStreamVideosToPool(): void {
  const pool = document.getElementById(SCREEN_SHARE_VIDEO_POOL_ID);
  if (!pool) return;

  document.querySelectorAll('video[id^="remote-video-"]').forEach((node) => {
    const video = node as HTMLVideoElement;
    if (!pool.contains(video)) {
      pool.appendChild(video);
    }
    video.style.display = 'block';
  });
}

export function getStreamMediaStream(userId: number): MediaStream | null {
  const video = getStreamVideoElement(userId);
  if (!video?.srcObject) return null;
  return video.srcObject as MediaStream;
}

export function isStreamVideoReady(userId: number): boolean {
  const video = getStreamVideoElement(userId);
  if (!video?.srcObject) return false;
  const stream = video.srcObject as MediaStream;
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') return false;
  return video.videoWidth > 0 && video.videoHeight > 0;
}

export function attachStreamToPreviewVideo(
  userId: number,
  previewVideo: HTMLVideoElement
): boolean {
  const sourceVideo = getStreamVideoElement(userId);
  const stream = sourceVideo?.srcObject as MediaStream | null;
  if (!stream) return false;

  if (previewVideo.srcObject !== stream) {
    previewVideo.srcObject = stream;
  }

  void previewVideo.play().catch(() => {});
  return true;
}
