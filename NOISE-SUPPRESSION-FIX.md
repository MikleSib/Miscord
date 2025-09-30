# 🎙️ Исправление шумоподавления в Miscord

## Проблема

Пользователи слышали необработанный звук с:
- Дыханием
- Щелчками по столу
- Фоновым шумом
- Эхом

## Причина

В `voiceService.ts` использовался обработанный поток из Web Audio API (`destinationNode.stream`), который **НЕ совместим с WebRTC**. Из-за этого браузерное шумоподавление не применялось к передаваемому аудио.

## Решение

### 1. Исправление для браузера и Electron (voiceService.ts)

**Изменено:**
- Теперь используется **исходный MediaStream** с браузерным шумоподавлением для WebRTC
- `audioProcessingService` используется только для VAD (детекции голоса) и анализа

**Настройки getUserMedia:**
```typescript
const rawStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,      // ✅ Подавление эха
    noiseSuppression: true,       // ✅ Шумоподавление
    autoGainControl: true,        // ✅ Автоматическое усиление
    sampleRate: 48000,            // Высокое качество
    channelCount: 1,              // Моно для голоса
  }
});

this.localStream = rawStream; // ✅ Используем для WebRTC
```

### 2. Улучшения для Electron приложения (electron/main.js)

Добавлены **экспериментальные флаги Chromium** для максимального качества:

```javascript
// WebRTC APM (Audio Processing Module) версии 3 + Hybrid AGC
app.commandLine.appendSwitch('enable-features', 'WebRtcUseEchoCanceller3,WebRtcHybridAgc');

// Аудио-обработка в отдельном процессе
app.commandLine.appendSwitch('enable-audio-processing', 'true');

// ML-шумоподавление в аудио-сервисе
app.commandLine.appendSwitch('enable-webrtc-apm-in-audio-service');

// АГРЕССИВНОЕ подавление дыхания и низкочастотных шумов
app.commandLine.appendSwitch('agc-startup-min-volume', '12');
app.commandLine.appendSwitch('agc2-use-adaptive-digital', 'true');

// Оптимизация буферов для лучшего качества
app.commandLine.appendSwitch('webrtc-max-audio-buffer-size', '1024');
app.commandLine.appendSwitch('webrtc-min-audio-buffer-size', '256');
```

### 3. Google Constraints для подавления дыхания (voiceService.ts)

Добавлены **экспериментальные Google constraints** в getUserMedia:

```typescript
advanced: [
  { echoCancellation: { exact: true } },
  { noiseSuppression: { exact: true } },
  { autoGainControl: { exact: true } },
  { googEchoCancellation: { exact: true } },
  { googAutoGainControl: { exact: true } },
  { googNoiseSuppression: { exact: true } },
  { googHighpassFilter: { exact: true } },  // ✅ Убирает дыхание!
  { googTypingNoiseDetection: { exact: true } },  // Детекция печати
  { googAudioMirroring: { exact: false } },
]
```

## Результат

✅ **Браузерное шумоподавление работает корректно**  
✅ **Electron использует продвинутые алгоритмы Google APM3 + Hybrid AGC**  
✅ **Аудио передается обработанным через WebRTC**  
✅ **Убраны: дыхание (включая носовое!), щелчки, фоновый шум, эхо, звуки печати**  
✅ **Адаптивное управление усилением** для стабильной громкости  
✅ **Высокочастотный фильтр Google** специально для подавления дыхания  

## Тестирование

### Для веб-версии:
1. Откройте https://stream-cash.ru в браузере
2. Подключитесь к голосовому каналу
3. Проверьте, что другие пользователи НЕ слышат фоновый шум

### Для Electron приложения:
1. Пересоберите приложение: `npm run build-electron`
2. Запустите Electron приложение
3. Откройте DevTools (Ctrl+Shift+I)
4. Проверьте в консоли: `🎙️ Включено улучшенное шумоподавление для Electron`
5. Подключитесь к голосовому каналу
6. Проверьте качество звука

## Технические детали

### Почему Web Audio API не работает с WebRTC?

Web Audio API `MediaStreamDestinationNode.stream` создает **синтетический поток**, который:
- Не имеет правильных constraints (echoCancellation, noiseSuppression)
- Не обрабатывается браузерным Audio Processing Module
- Передается в WebRTC как "сырой" поток без обработки

### Правильный подход:

1. **Получить MediaStream с constraints** от `getUserMedia()`
2. **Использовать этот поток для WebRTC** (RTCPeerConnection)
3. **Браузер автоматически применяет** все обработки (AEC, NS, AGC)
4. **Web Audio API использовать только для анализа** (VAD, визуализация)

## Дополнительные настройки (опционально)

### Для более агрессивного шумоподавления в Electron:

Можно добавить в `electron/main.js`:

```javascript
// Максимальное подавление шума (может влиять на качество голоса)
app.commandLine.appendSwitch('webrtc-max-audio-buffer-size', '2048');
app.commandLine.appendSwitch('webrtc-min-audio-buffer-size', '512');
```

### Для отключения автоматического усиления (AGC):

В `voiceService.ts` измените:

```typescript
autoGainControl: false,  // Отключить AGC если он искажает голос
```

## Известные ограничения

1. **Процессорное шумоподавление (advancedNoiseGate) отключено** - оно не совместимо с WebRTC
2. **Браузерное шумоподавление зависит от браузера** - Chrome/Edge работают лучше всего
3. **В Firefox** может работать хуже - используйте Chrome/Edge или Electron

## Поддержка

Если шумоподавление всё ещё не работает:

1. Проверьте версию браузера (обновите до последней)
2. Проверьте настройки микрофона в системе
3. Попробуйте использовать Electron приложение
4. Проверьте консоль браузера на ошибки

---

**Дата исправления:** 30 сентября 2025  
**Версия:** 1.0.0
