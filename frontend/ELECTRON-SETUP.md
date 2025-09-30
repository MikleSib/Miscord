# Electron Desktop App Setup

Это руководство поможет вам запустить Miscord как десктопное приложение с помощью Electron.

## Установка зависимостей

```bash
cd frontend
npm install
```

## Режим разработки

Для запуска в режиме разработки (с hot reload):

```bash
npm run electron-dev
```

Это команда:
1. Запустит Next.js dev server на порту 3000
2. Дождется готовности сервера
3. Запустит Electron приложение

## Сборка для продакшена

### 1. Сборка Next.js приложения

```bash
npm run build-electron
```

### 2. Создание установочного файла

```bash
npm run dist
```

Готовые установочные файлы будут в папке `dist/`:
- Windows: `.exe` файл
- macOS: `.dmg` файл  
- Linux: `.AppImage` файл

## Структура проекта

```
frontend/
├── electron/
│   ├── main.js          # Главный процесс Electron
│   └── preload.js       # Preload скрипт для безопасности
├── scripts/
│   └── build-electron.js # Скрипт сборки
├── src/
│   ├── components/
│   │   └── ElectronTitleBar.tsx # Кастомная панель заголовка
│   └── types/
│       └── electron.d.ts        # TypeScript типы
└── out/                 # Собранное Next.js приложение
```

## Возможности

- ✅ Кастомная панель заголовка
- ✅ Управление окном (свернуть/развернуть/закрыть)
- ✅ Безопасная связь между процессами
- ✅ Автоматическая сборка
- ✅ Кроссплатформенность
- ✅ Горячая перезагрузка в dev режиме

## Настройка

### Изменение настроек окна

Отредактируйте `electron/main.js`:

```javascript
mainWindow = new BrowserWindow({
  width: 1200,        // Ширина
  height: 800,        // Высота
  minWidth: 800,      // Минимальная ширина
  minHeight: 600,     // Минимальная высота
  // ... другие настройки
});
```

### Добавление новых IPC каналов

1. В `electron/main.js` добавьте обработчик:
```javascript
ipcMain.handle('your-channel', () => {
  // Ваша логика
});
```

2. В `electron/preload.js` экспортируйте API:
```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... существующие методы
  yourMethod: () => ipcRenderer.invoke('your-channel'),
});
```

3. В `src/types/electron.d.ts` добавьте тип:
```typescript
interface ElectronAPI {
  // ... существующие методы
  yourMethod: () => Promise<any>;
}
```

## Troubleshooting

### Ошибка "Cannot find module 'electron'"
```bash
npm install electron --save-dev
```

### Приложение не запускается
1. Убедитесь, что Next.js dev server запущен на порту 3000
2. Проверьте, что все зависимости установлены
3. Очистите кэш: `rm -rf node_modules package-lock.json && npm install`

### Проблемы со сборкой
1. Убедитесь, что Next.js настроен для статического экспорта
2. Проверьте переменную окружения `ELECTRON=true`
3. Убедитесь, что папка `out/` создается после сборки





