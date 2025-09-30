const { app, BrowserWindow, Menu, shell, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;

// 🎙️ МАКСИМАЛЬНОЕ ШУМОПОДАВЛЕНИЕ ДЛЯ ELECTRON
// ВАЖНО: Флаги командной строки должны быть установлены ДО создания окна!
try {
  // Включаем экспериментальный WebRTC APM (Audio Processing Module) версии 3
  // Это новейший алгоритм шумоподавления от Google
  app.commandLine.appendSwitch('enable-features', 'WebRtcUseEchoCanceller3,WebRtcHybridAgc');
  
  // Принудительно включаем все аудио-обработки в отдельном процессе
  app.commandLine.appendSwitch('enable-audio-processing', 'true');
  
  // Включаем экспериментальное шумоподавление на основе ML в аудио-сервисе
  app.commandLine.appendSwitch('enable-webrtc-apm-in-audio-service');
  
  // Включаем WebRTC PipeWire для лучшей совместимости с Linux
  app.commandLine.appendSwitch('enable-webrtc-pipewire-capturer');
  
  // АГРЕССИВНОЕ ШУМОПОДАВЛЕНИЕ - убирает дыхание и низкочастотные шумы
  app.commandLine.appendSwitch('agc-startup-min-volume', '12');  // Минимальная громкость при старте
  app.commandLine.appendSwitch('agc2-use-adaptive-digital', 'true');  // Адаптивное усиление v2
  
  // Оптимизация буферов для лучшего качества (меньше задержка = лучше обработка)
  app.commandLine.appendSwitch('webrtc-max-audio-buffer-size', '1024');
  app.commandLine.appendSwitch('webrtc-min-audio-buffer-size', '256');
  
  console.log('🎙️ Включено МАКСИМАЛЬНОЕ шумоподавление для Electron (включая дыхание)');
} catch (e) {
  console.error('❌ Ошибка включения флагов шумоподавления:', e);
}

function createWindow() {
  // Создаем главное окно приложения
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/favicon.ico'),
    titleBarStyle: 'default',
    show: false,
    backgroundThrottling: false
  });

  // Загружаем приложение
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('isDev:', isDev);
  
  // Всегда загружаем сайт stream-cash.ru (не локальные файлы)
  console.log('Загружаем https://stream-cash.ru/');
  mainWindow.loadURL('https://stream-cash.ru/');

  // Показываем окно когда оно готово
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Обработка внешних ссылок
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Открываем внешние ссылки в системном браузере
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Обработка навигации по ссылкам
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    // Если ссылка ведет на другой домен, открываем в браузере
    if (parsedUrl.origin !== 'https://stream-cash.ru') {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  // Создаем меню приложения
  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'Miscord',
      submenu: [
        {
          label: 'О программе Miscord',
          click: () => {
            // Показать информацию о программе
          }
        },
        { type: 'separator' },
        {
          label: 'Выход',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Повторить', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Копировать', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Вставить', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Перезагрузить', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Принудительная перезагрузка', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: 'Инструменты разработчика', accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Увеличить', accelerator: 'CmdOrCtrl+Plus', role: 'zoomin' },
        { label: 'Уменьшить', accelerator: 'CmdOrCtrl+-', role: 'zoomout' },
        { label: 'Сбросить масштаб', accelerator: 'CmdOrCtrl+0', role: 'resetzoom' },
        { type: 'separator' },
        { label: 'Полноэкранный режим', accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Окно',
      submenu: [
        { label: 'Свернуть', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: 'Закрыть', accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Обработчики событий приложения
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC обработчики для связи с renderer процессом
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('close-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

// Предоставляем список источников для захвата экрана через IPC,
// чтобы не зависеть от доступности desktopCapturer в preload/renderer
ipcMain.handle('get-desktop-sources', async (_event, options = {}) => {
  const { thumbnailSize = { width: 320, height: 180 }, fetchWindowIcons = true } = options || {};
  try {
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
  } catch (e) {
    return { error: String(e) };
  }
});
