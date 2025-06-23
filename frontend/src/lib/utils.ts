import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, isToday, isYesterday, differenceInDays } from 'date-fns'
import { ru } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Получить часовой пояс пользователя
 */
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * Конвертировать UTC время в локальное время пользователя
 */
export function convertToUserTimezone(utcDate: string | Date): Date {
  if (typeof utcDate === 'string') {
    // Если строка не содержит timezone информацию, добавляем Z для UTC
    if (!utcDate.includes('Z') && !utcDate.includes('+') && !utcDate.includes('-')) {
      utcDate = utcDate.endsWith('Z') ? utcDate : utcDate + 'Z'
    }
    return new Date(utcDate)
  }
  
  return utcDate
}

/**
 * Форматировать время сообщения с учетом локального времени
 */
export function formatMessageTime(timestamp: string | Date): string {
  const localDate = convertToUserTimezone(timestamp)
  const now = new Date()
  
  // Если сообщение сегодня - показываем только время
  if (isToday(localDate)) {
    return format(localDate, 'HH:mm', { locale: ru })
  }
  
  // Если сообщение вчера
  if (isYesterday(localDate)) {
    return `вчера в ${format(localDate, 'HH:mm', { locale: ru })}`
  }
  
  // Если сообщение в текущем году
  const daysDiff = differenceInDays(now, localDate)
  if (daysDiff < 7) {
    return format(localDate, 'EEEE в HH:mm', { locale: ru })
  }
  
  // Если в текущем году
  if (localDate.getFullYear() === now.getFullYear()) {
    return format(localDate, 'd MMM в HH:mm', { locale: ru })
  }
  
  // Если в другом году
  return format(localDate, 'd MMM yyyy в HH:mm', { locale: ru })
}

/**
 * Форматировать полное время сообщения для tooltip
 */
export function formatMessageFullTime(timestamp: string | Date): string {
  const localDate = convertToUserTimezone(timestamp)
  const timezone = getUserTimezone()
  
  return `${format(localDate, 'd MMMM yyyy, HH:mm:ss', { locale: ru })} (${timezone})`
}

/**
 * Форматировать дату для разделителей между днями
 */
export function formatDateDivider(timestamp: string | Date): string {
  const localDate = convertToUserTimezone(timestamp)
  const now = new Date()
  
  if (isToday(localDate)) {
    return 'Сегодня'
  }
  
  if (isYesterday(localDate)) {
    return 'Вчера'
  }
  
  // Если в текущем году
  if (localDate.getFullYear() === now.getFullYear()) {
    return format(localDate, 'd MMMM', { locale: ru })
  }
  
  // Если в другом году
  return format(localDate, 'd MMMM yyyy', { locale: ru })
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
  
  if (diffInHours < 24) {
    return date.toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } else if (diffInHours < 48) {
    return 'Вчера';
  } else {
    return date.toLocaleDateString('ru-RU', { 
      day: '2-digit', 
      month: '2-digit' 
    });
  }
} 