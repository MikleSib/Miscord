# 🚀 Быстрое руководство по отладке Miscord

## 🔧 Включение детального логирования

### В консоли браузера (F12):

```javascript
// 1. Включить подробное логирование голоса
voiceService.enableAudioDataLogging(true);

// 2. Получить диагностику голосовых проблем
const audioDiag = voiceService.diagnoseAudioIssues();
console.log('Диагностика голоса:', audioDiag);

// 3. Получить метрики WebSocket
const wsDebug = websocketService.getDebugInfo();
console.log('WebSocket отладка:', wsDebug);

// 4. Получить общую диагностику голоса
const voiceDebug = voiceService.getDebugInfo();
console.log('Общая диагностика голоса:', voiceDebug);
```

## 🔍 Поиск проблем по логам

Откройте консоль браузера (F12) и найдите:

- `🔔` - WebSocket уведомления
- `🎙️` - Голосовые соединения  
- `🖥️` - Демонстрация экрана
- `❌` - Ошибки
- `⚠️` - Предупреждения
- `✅` - Успешные операции

## 🚨 Частые проблемы

### 1. "Голос не слышен"
```javascript
// Диагностика
voiceService.diagnoseAudioIssues();

// Проверьте в логах:
// - Есть ли локальный поток микрофона
// - Подключены ли peer connections  
// - Созданы ли аудио элементы
// - Нет ли ошибок autoplay
```

### 2. "WebSocket постоянно переподключается"
```javascript
// Проверка статуса
websocketService.getDebugInfo();

// Найдите в логах:
// - Причины отключений
// - Состояние токена авторизации
// - Сетевые ошибки
```

### 3. "Накапливаются соединения"
```javascript
// Статистика сервера (если есть доступ)
fetch('/api/debug/websocket-stats')
  .then(r => r.json())
  .then(stats => console.log('Статистика сервера:', stats));

// Принудительная очистка (только для админов)
fetch('/api/debug/cleanup-connections', { method: 'POST' });
```

## 📊 Мониторинг в реальном времени

### Добавьте в код для постоянного мониторинга:

```javascript
// Включить детальные логи
voiceService.enableAudioDataLogging(true);

// Мониторинг каждые 10 секунд
setInterval(() => {
    const wsStats = websocketService.getDebugInfo();
    const voiceStats = voiceService.getAudioMetrics();
    
    console.log('📊 Состояние WebSocket:', wsStats);
    console.log('📊 Состояние голоса:', voiceStats);
}, 10000);
```

## 🛠️ API для мониторинга

### Статистика сервера:
```
GET /api/debug/websocket-stats
GET /api/debug/health
```

### Управление соединениями:
```
POST /api/debug/cleanup-connections
```

## 💡 Решения типичных проблем

### Autoplay заблокирован:
- Кликните в любом месте страницы
- Включите автовоспроизведение в настройках браузера

### Микрофон не работает:
- Проверьте разрешения в браузере
- Убедитесь что микрофон не используется другим приложением

### Плохое качество звука:
- Проверьте WebRTC статистику в логах
- Убедитесь в стабильности сетевого соединения

## 🎯 Быстрая диагностика в одну команду

```javascript
// Полная диагностика системы
function fullDiagnosis() {
    console.log('🔍 === ПОЛНАЯ ДИАГНОСТИКА MISCORD ===');
    
    // WebSocket диагностика
    console.log('🔔 WebSocket:');
    console.log(websocketService.getDebugInfo());
    
    // Голосовая диагностика
    console.log('🎙️ Голос:');
    const voiceDiag = voiceService.diagnoseAudioIssues();
    
    // Рекомендации
    console.log('💡 Рекомендации:');
    voiceDiag.recommendations.forEach(rec => console.log(rec));
    
    console.log('🔍 === ДИАГНОСТИКА ЗАВЕРШЕНА ===');
}

// Запустить диагностику
fullDiagnosis();
```

Скопируйте эту функцию в консоль браузера для быстрой диагностики всех проблем!