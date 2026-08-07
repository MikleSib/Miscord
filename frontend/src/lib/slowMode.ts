export const SLOW_MODE_OPTIONS = [
  { value: 0, label: 'Выкл' },
  { value: 5, label: '5 секунд' },
  { value: 10, label: '10 секунд' },
  { value: 15, label: '15 секунд' },
  { value: 30, label: '30 секунд' },
  { value: 60, label: '1 минута' },
  { value: 120, label: '2 минуты' },
  { value: 300, label: '5 минут' },
  { value: 600, label: '10 минут' },
  { value: 900, label: '15 минут' },
  { value: 3600, label: '1 час' },
  { value: 7200, label: '2 часа' },
  { value: 21600, label: '6 часов' },
] as const;

export function formatSlowModeLabel(seconds: number): string {
  const option = SLOW_MODE_OPTIONS.find((item) => item.value === seconds);
  if (option) return option.label;
  if (seconds <= 0) return 'Выкл';
  if (seconds < 60) return `${seconds} секунд`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} минут`;
  return `${Math.round(seconds / 3600)} ч`;
}

export function formatSlowModeHint(seconds: number): string {
  if (seconds <= 0) {
    return 'Участники смогут отправлять сообщения без ограничений по времени.';
  }
  return `Участники смогут отправлять не чаще одного сообщения каждые ${formatSlowModeLabel(seconds).toLowerCase()}. Администраторы ограничение не получают.`;
}
