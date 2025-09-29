const { contextBridge, ipcRenderer } = require('electron');

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
