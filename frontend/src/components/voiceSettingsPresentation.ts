import type { NoiseSuppressionRuntimeStatus } from '../store/noiseSuppressionStore';
import type {
  VoiceProcessingProfile,
} from '../services/voiceSettings';
import type { NoiseSuppressionEngine } from '../store/noiseSuppressionStore';

export const PROFILE_COPY: Record<
  VoiceProcessingProfile,
  { title: string; description: string }
> = {
  isolation: {
    title: 'Изоляция голоса',
    description: 'DeepFilterNet3, эхоподавление и обработка голоса.',
  },
  studio: {
    title: 'Студия',
    description: 'Чистый микрофон без слышимой обработки.',
  },
  custom: {
    title: 'Пользовательский',
    description: 'Ручное управление каждым этапом обработки.',
  },
};

export const ENGINE_LABELS: Record<NoiseSuppressionEngine, string> = {
  deepfilternet3: 'DeepFilterNet3',
  'miscord-ai': 'Miscord AI',
  browser: 'Браузерный',
};

export function statusLabel(status: NoiseSuppressionRuntimeStatus): string {
  if (status === 'loading') return 'Загрузка';
  if (status === 'active') return 'Активен';
  if (status === 'fallback') return 'Fallback';
  if (status === 'error') return 'Ошибка';
  return 'Выключен';
}
