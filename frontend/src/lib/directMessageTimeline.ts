import { format, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'

import type { DirectMessage } from '../types'

const GROUP_WINDOW_MS = 7 * 60 * 1000

function calendarDay(value: string): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function isDirectMessageGroupStart(
  message: DirectMessage,
  previous?: DirectMessage,
): boolean {
  if (!previous || previous.sender_id !== message.sender_id) return true
  if (calendarDay(previous.timestamp) !== calendarDay(message.timestamp)) return true

  const elapsed = new Date(message.timestamp).getTime() - new Date(previous.timestamp).getTime()
  return !Number.isFinite(elapsed) || elapsed < 0 || elapsed > GROUP_WINDOW_MS
}

export function needsDirectMessageDateSeparator(
  message: DirectMessage,
  previous?: DirectMessage,
): boolean {
  return !previous || calendarDay(previous.timestamp) !== calendarDay(message.timestamp)
}

export function formatDirectMessageDate(value: string): string {
  const date = new Date(value)
  if (isToday(date)) return 'Сегодня'
  if (isYesterday(date)) return 'Вчера'
  return format(date, 'd MMMM yyyy г.', { locale: ru })
}

export function formatDirectMessageTime(value: string): string {
  return format(new Date(value), 'HH:mm', { locale: ru })
}
