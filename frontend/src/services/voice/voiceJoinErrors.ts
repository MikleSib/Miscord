const JOIN_ERRORS: Record<string, string> = {
  stage_not_active: 'Сцена ещё не запущена. Модератор должен сначала начать Stage.',
  voice_channel_forbidden: 'У вас нет права подключаться к этому голосовому каналу.',
  voice_channel_full: 'Голосовой канал заполнен.',
  voice_channel_not_found: 'Голосовой канал больше не существует.',
  invalid_voice_channel: 'Не удалось найти голосовой канал.',
}

export function voiceJoinErrorMessage(data: { code?: string; message?: string }): string {
  if (data.code && JOIN_ERRORS[data.code]) return JOIN_ERRORS[data.code]
  return data.message || 'Не удалось войти в голосовой канал.'
}
