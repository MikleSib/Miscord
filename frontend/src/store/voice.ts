/**
 * Экспорт оптимизированного voice store
 * Используйте этот файл вместо slices/voiceSlice для получения оптимизированной версии
 */

export { 
  useOptimizedVoiceStore,
  useVoiceStore,
  default as optimizedVoiceStore 
} from './slices/optimizedVoiceSlice';

// Переэкспортируем под старым именем для обратной совместимости
export { useVoiceStore as useVoiceStoreOptimized } from './slices/optimizedVoiceSlice';

