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
    try {
      // Сначала пробуем напрямую
      if (desktopCapturer && desktopCapturer.getSources) {
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
      }
    } catch {}

    // Fallback: через main по IPC
    const result = await ipcRenderer.invoke('get-desktop-sources', { thumbnailSize, fetchWindowIcons });
    if (result && !result.error) return result;
    console.warn('[electronAPI] getDesktopSources failed via IPC:', result?.error);
    return [];
  },

  // Получить MediaStream для выбранного источника (с системным звуком по желанию)
  getDesktopStream: async (sourceId, withSystemAudio = true, frameRate = 30) => {
    const buildConstraints = (audioMode) => ({
      audio: audioMode
        ? {
            mandatory: {
              chromeMediaSource: 'desktop',
              ...(sourceId ? { chromeMediaSourceId: sourceId } : {})
            }
          }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          ...(sourceId ? { chromeMediaSourceId: sourceId } : {}),
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

// Полифилл getDisplayMedia для страниц, загружаемых внутри Electron, чтобы всегда получать MediaStream
(() => {
  try {
    const ensureGetDisplayMedia = async () => {
      const nmd = navigator.mediaDevices;
      if (!nmd || typeof nmd.getUserMedia !== 'function') return;

      const pickPrimaryScreen = async () => {
        try {
          const sources = await (window.electronAPI?.getDesktopSources?.({}) || ipcRenderer.invoke('get-desktop-sources', {}));
          if (Array.isArray(sources) && sources.length > 0) {
            const primary = sources.find(s => s.type === 'screen' && /1|Primary|Главный/i.test(s.name))
              || sources.find(s => s.type === 'screen')
              || sources[0];
            return primary?.id;
          }
        } catch {}
        return undefined;
      };

      // Если getDisplayMedia отсутствует или мы хотим переопределить под Electron — переопределим
      const originalGDM = nmd.getDisplayMedia?.bind(nmd);
      nmd.getDisplayMedia = async (constraints) => {
        try {
          const sourceId = await pickPrimaryScreen();
          const wantAudio = typeof constraints === 'object' ? !!(constraints && (constraints.audio === true || (constraints.audio && constraints.audio !== false))) : true;
          const stream = await nmd.getUserMedia({
            audio: wantAudio ? { mandatory: { chromeMediaSource: 'desktop', ...(sourceId ? { chromeMediaSourceId: sourceId } : {}) } } : false,
            video: { mandatory: { chromeMediaSource: 'desktop', ...(sourceId ? { chromeMediaSourceId: sourceId } : {}), maxFrameRate: 30, minFrameRate: 15, maxWidth: 1920, maxHeight: 1080 } }
          });
          return stream;
        } catch (e1) {
          if (originalGDM) {
            try { return await originalGDM(constraints); } catch {}
          }
          // Повтор без аудио
          try {
            const sourceId = await pickPrimaryScreen();
            return await nmd.getUserMedia({
              audio: false,
              video: { mandatory: { chromeMediaSource: 'desktop', ...(sourceId ? { chromeMediaSourceId: sourceId } : {}), maxFrameRate: 30, minFrameRate: 15, maxWidth: 1920, maxHeight: 1080 } }
            });
          } catch (e2) {
            console.warn('[electron preload] getDisplayMedia polyfill failed:', e1, e2);
            throw e2;
          }
        }
      };
    };

    // Выполняем сразу (после загрузки контекста)
    ensureGetDisplayMedia();
  } catch (e) {
    console.warn('[electron preload] Failed to install getDisplayMedia polyfill:', e);
  }
})();

// Дополнительно внедрим такой же полифилл непосредственно в контекст страницы,
// чтобы MediaStream создавался в том же мире (исключает проблемы с прототипами)
window.addEventListener('DOMContentLoaded', () => {
  try {
    const code = `(() => {
      try {
        const inject = async () => {
          const nmd = navigator.mediaDevices;
          if (!nmd || typeof nmd.getUserMedia !== 'function') return;
          const original = nmd.getDisplayMedia?.bind(nmd);
          const pick = async () => {
            try {
              const list = await (window.electronAPI && window.electronAPI.getDesktopSources ? window.electronAPI.getDesktopSources({}) : Promise.resolve([]));
              if (Array.isArray(list) && list.length) {
                const primary = list.find(s => s.type === 'screen' && /1|Primary|Главный/i.test(s.name)) || list.find(s => s.type === 'screen') || list[0];
                return primary && primary.id;
              }
            } catch {}
            return undefined;
          };
          nmd.getDisplayMedia = async (constraints) => {
            const id = await pick();
            const wantAudio = typeof constraints === 'object' ? !!(constraints && (constraints.audio === true || (constraints.audio && constraints.audio !== false))) : true;
            const build = (withAudio) => ({
              audio: withAudio ? { mandatory: { chromeMediaSource: 'desktop', ...(id ? { chromeMediaSourceId: id } : {}) } } : false,
              video: { mandatory: { chromeMediaSource: 'desktop', ...(id ? { chromeMediaSourceId: id } : {}), maxFrameRate: 30, minFrameRate: 15, maxWidth: 1920, maxHeight: 1080 } }
            });
            try {
              return await nmd.getUserMedia(build(wantAudio));
            } catch (e1) {
              if (original) { try { return await original(constraints); } catch {} }
              return await nmd.getUserMedia(build(false));
            }
          };
        };
        inject();
      } catch (e) { console.warn('[page] inject getDisplayMedia polyfill failed:', e); }
    })();`;
    const s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } catch (e) {
    console.warn('[electron preload] Failed to inject page polyfill:', e);
  }
});
