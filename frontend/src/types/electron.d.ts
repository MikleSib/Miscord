declare global {
  interface Window {
    electronAPI?: {
      // Window controls
      minimizeWindow?: () => Promise<void> | void;
      maximizeWindow?: () => Promise<void> | void;
      closeWindow?: () => Promise<void> | void;

      // Platform info
      platform?: string;

      // Desktop capture helpers (Electron only)
      getDesktopSources?: (options?: any) => Promise<Array<{
        id: string;
        name: string;
        type: string;
        display_id?: string | number;
        thumbnailDataURL?: string | null;
      }>>;
      getDesktopStream?: (
        sourceId: string,
        withSystemAudio?: boolean,
        frameRate?: number
      ) => Promise<MediaStream>;

      // Misc
      getAppVersion?: () => Promise<string>;
    };
  }
}

export {};

// Типы для Electron API
export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  platform: string;
  showNotification: (title: string, body: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
