const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

// Безопасно экспортируем API в renderer процесс
contextBridge.exposeInMainWorld('electronAPI', {
  // Получить версию приложения
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Управление окном
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  
  // Информация о платформе
  platform: process.platform,
  
  // Уведомления
  showNotification: (title, body) => {
    // Здесь можно добавить логику для показа уведомлений
    console.log('Notification:', title, body);
  },

  // Источники захвата рабочего стола (экраны и окна)
  getDesktopSources: async (options = {}) => {
    const { thumbnailSize = { width: 320, height: 180 }, fetchWindowIcons = true } = options;
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize,
      fetchWindowIcons
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
      appIconDataURL: s.appIcon ? s.appIcon.toDataURL() : null,
      thumbnailDataURL: s.thumbnail ? s.thumbnail.toDataURL() : null,
      type: s.id.startsWith('screen:') ? 'screen' : 'window'
    }));
  },

  // Получить MediaStream для выбранного источника (с системным звуком по желанию)
  getDesktopStream: async (sourceId, withSystemAudio = true, frameRate = 30) => {
    const buildConstraints = (audioMode) => ({
      audio: audioMode
        ? {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: frameRate,
          minFrameRate: Math.min(15, frameRate),
          maxWidth: 1920,
          maxHeight: 1080
        }
      }
    });

    try {
      return await navigator.mediaDevices.getUserMedia(buildConstraints(withSystemAudio));
    } catch (e1) {
      console.warn('[electronAPI] desktop getUserMedia with audio failed, retrying without audio:', e1);
      try {
        return await navigator.mediaDevices.getUserMedia(buildConstraints(false));
      } catch (e2) {
        // One more attempt: some platforms require audio without id
        if (withSystemAudio) {
          try {
            const constraintsNoId = {
              audio: { mandatory: { chromeMediaSource: 'desktop' } },
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                  maxFrameRate: frameRate,
                  minFrameRate: Math.min(15, frameRate),
                  maxWidth: 1920,
                  maxHeight: 1080
                }
              }
            };
            return await navigator.mediaDevices.getUserMedia(constraintsNoId);
          } catch (e3) {
            console.error('[electronAPI] desktop getUserMedia all attempts failed:', e3);
            throw e3;
          }
        }
        throw e2;
      }
    }
  }
});

// Предотвращаем появление предупреждений о безопасности
window.addEventListener('DOMContentLoaded', () => {
  // Добавляем класс для Electron в body
  document.body.classList.add('electron-app');
  
  // Отключаем контекстное меню в production
  if (process.env.NODE_ENV === 'production') {
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }
});
