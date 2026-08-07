export type StreamPreset = 'games' | 'screen' | 'custom';
export type StreamResolution = '720' | '1080' | '1440' | 'source';
export type StreamFps = 15 | 30 | 60;

export type StreamQualitySettings = {
  preset: StreamPreset;
  resolution: StreamResolution;
  fps: StreamFps;
  muteStreamAudio: boolean;
};

export type ResolvedStreamQuality = {
  resolution: StreamResolution;
  fps: StreamFps;
  contentHint: 'motion' | 'detail';
};

export const RESOLUTION_DIMENSIONS: Record<
  Exclude<StreamResolution, 'source'>,
  { width: number; height: number; label: string }
> = {
  '720': { width: 1280, height: 720, label: '720p' },
  '1080': { width: 1920, height: 1080, label: '1080p' },
  '1440': { width: 2560, height: 1440, label: '1440p' },
};

export function resolveQualitySettings(
  settings: StreamQualitySettings
): ResolvedStreamQuality {
  if (settings.preset === 'games') {
    return { resolution: '1440', fps: 60, contentHint: 'motion' };
  }
  if (settings.preset === 'screen') {
    return { resolution: 'source', fps: 15, contentHint: 'detail' };
  }
  return {
    resolution: settings.resolution,
    fps: settings.fps,
    contentHint: settings.fps >= 30 ? 'motion' : 'detail',
  };
}

export function getDisplayMediaVideoConstraints(
  resolved: ResolvedStreamQuality
): MediaTrackConstraints {
  if (resolved.resolution === 'source') {
    return {
      frameRate: { ideal: resolved.fps, max: resolved.fps },
    };
  }

  const size = RESOLUTION_DIMENSIONS[resolved.resolution];
  return {
    width: { ideal: size.width, max: size.width },
    height: { ideal: size.height, max: size.height },
    frameRate: { ideal: resolved.fps, max: resolved.fps },
  };
}

export function getElectronCaptureConstraints(resolved: ResolvedStreamQuality) {
  if (resolved.resolution === 'source') {
    return {
      maxFrameRate: resolved.fps,
      minFrameRate: Math.min(15, resolved.fps),
    };
  }

  const size = RESOLUTION_DIMENSIONS[resolved.resolution];
  return {
    maxFrameRate: resolved.fps,
    minFrameRate: Math.min(15, resolved.fps),
    maxWidth: size.width,
    maxHeight: size.height,
  };
}

function getTargetBitrate(resolution: StreamResolution, fps: StreamFps): number {
  const table: Record<string, number> = {
    '720-15': 1_800_000,
    '720-30': 3_500_000,
    '720-60': 5_500_000,
    '1080-15': 3_000_000,
    '1080-30': 6_000_000,
    '1080-60': 9_000_000,
    '1440-15': 5_000_000,
    '1440-30': 9_000_000,
    '1440-60': 14_000_000,
    'source-15': 3_500_000,
    'source-30': 7_000_000,
    'source-60': 12_000_000,
  };
  return table[`${resolution}-${fps}`] ?? 6_000_000;
}

export function getScreenShareEncoding(
  resolved: ResolvedStreamQuality,
  trackSettings?: MediaTrackSettings
): RTCRtpEncodingParameters {
  const maxBitrate = getTargetBitrate(resolved.resolution, resolved.fps);
  let scaleResolutionDownBy = 1;

  if (
    resolved.resolution !== 'source' &&
    trackSettings?.width &&
    trackSettings.width > 0
  ) {
    const targetWidth = RESOLUTION_DIMENSIONS[resolved.resolution].width;
    if (trackSettings.width > targetWidth) {
      scaleResolutionDownBy = trackSettings.width / targetWidth;
    }
  }

  return {
    maxBitrate,
    maxFramerate: resolved.fps,
    scaleResolutionDownBy,
    priority: 'high',
    degradationPreference: 'maintain-resolution',
  } as RTCRtpEncodingParameters;
}

export function formatStreamQualityLabel(resolved: ResolvedStreamQuality): string {
  const resolutionLabel =
    resolved.resolution === 'source'
      ? 'Источник'
      : RESOLUTION_DIMENSIONS[resolved.resolution].label;
  return `${resolutionLabel} · ${resolved.fps} к/с`;
}

export function formatPresetDescription(preset: StreamPreset): string {
  if (preset === 'games') return 'Более плавное видео (1440p, 60 к/сек.)';
  if (preset === 'screen') return 'Более чёткий текст (Источник, 15 к/сек.)';
  return 'Своё разрешение и частота кадров';
}
