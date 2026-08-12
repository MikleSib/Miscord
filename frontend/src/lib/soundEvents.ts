export type SoundEventId =
  | 'mic-off'
  | 'mic-on'
  | 'voice-join'
  | 'voice-leave'
  | 'message'
  | 'call-incoming'
  | 'call-outgoing'
  | 'stream-start'
  | 'stream-end'
  | 'stream-join'

export interface SoundEventDefinition {
  id: SoundEventId
  label: string
  description: string
  source: string
  volume: number
  featured?: boolean
}

export const SOUND_EVENTS: SoundEventDefinition[] = [
  {
    id: 'mic-off',
    label: 'Отключение микрофона',
    description: 'Когда вы выключаете свой микрофон.',
    source: '/music/mic_off.mp3',
    volume: 0.45,
    featured: true,
  },
  {
    id: 'mic-on',
    label: 'Включение микрофона',
    description: 'Когда вы снова включаете микрофон.',
    source: '/music/mic_on.mp3',
    volume: 0.45,
    featured: true,
  },
  {
    id: 'voice-join',
    label: 'Подключение к голосовому каналу',
    description: 'Когда вы или участник подключаетесь к голосовому каналу.',
    source: '/music/звук подключения к звонку.mp3',
    volume: 0.35,
    featured: true,
  },
  {
    id: 'voice-leave',
    label: 'Отключение от голосового канала',
    description: 'Когда вы или участник покидаете голосовой канал.',
    source: '/music/звук отключения от звонка.mp3',
    volume: 0.35,
    featured: true,
  },
  {
    id: 'message',
    label: 'Новое сообщение',
    description: 'Для личных сообщений и важных упоминаний.',
    source: '/music/уведомление_sms.mp3',
    volume: 0.5,
  },
  {
    id: 'call-incoming',
    label: 'Входящий звонок',
    description: 'Пока вам звонит другой пользователь.',
    source: '/music/звонок.mp3',
    volume: 0.5,
  },
  {
    id: 'call-outgoing',
    label: 'Исходящий звонок',
    description: 'Пока вы ожидаете ответа на звонок.',
    source: '/music/звонок.mp3',
    volume: 0.5,
  },
  {
    id: 'stream-start',
    label: 'Демонстрация экрана включена',
    description: 'Когда начинается ваша демонстрация экрана.',
    source: '/music/звук включения стрима.mp3',
    volume: 0.45,
  },
  {
    id: 'stream-end',
    label: 'Демонстрация экрана завершена',
    description: 'Когда ваша демонстрация экрана останавливается.',
    source: '/music/звук выключения стрима.mp3',
    volume: 0.45,
  },
  {
    id: 'stream-join',
    label: 'Подключение к демонстрации',
    description: 'Когда зритель открывает демонстрацию экрана.',
    source: '/music/звук присоединения к стриму.mp3',
    volume: 0.45,
  },
]

export const DEFAULT_SOUND_PREFERENCES = Object.fromEntries(
  SOUND_EVENTS.map((event) => [event.id, true]),
) as Record<SoundEventId, boolean>

export function getSoundEvent(id: SoundEventId): SoundEventDefinition {
  const event = SOUND_EVENTS.find((item) => item.id === id)
  if (!event) throw new Error(`Unknown sound event: ${id}`)
  return event
}
