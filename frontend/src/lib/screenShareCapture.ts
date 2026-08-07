export type ScreenSharePickerTab = 'applications' | 'screen' | 'devices';

export type ScreenShareCaptureSource = {
  id: string;
  name: string;
  type: 'screen' | 'window';
  thumbnailDataURL?: string | null;
  appIconDataURL?: string | null;
};

export type StartScreenShareOptions = {
  sourceId?: string;
  /** window → окно, monitor → весь экран, browser → вкладка браузера */
  preferDisplaySurface?: 'window' | 'monitor' | 'browser';
};

export function isElectronCaptureAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.electronAPI &&
    typeof window.electronAPI.getDesktopSources === 'function'
  );
}

export function mapPickerTabToDisplaySurface(
  tab: ScreenSharePickerTab
): StartScreenShareOptions['preferDisplaySurface'] {
  if (tab === 'screen') return 'monitor';
  if (tab === 'devices') return 'browser';
  return 'window';
}

export function filterSourcesByTab(
  sources: ScreenShareCaptureSource[],
  tab: ScreenSharePickerTab
): ScreenShareCaptureSource[] {
  if (tab === 'screen') {
    return sources.filter((source) => source.type === 'screen');
  }
  if (tab === 'applications') {
    return sources.filter((source) => source.type === 'window');
  }
  return sources.filter((source) => source.type === 'window');
}
