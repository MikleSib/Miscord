export type HotkeyAction =
  | 'toggle-mute'
  | 'toggle-deafen'
  | 'toggle-input-mode'
  | 'toggle-screen-share'
  | 'disconnect-voice'
  | 'open-voice-settings'
  | 'navigate-back'
  | 'navigate-forward'

export interface HotkeyCombination {
  code: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export interface HotkeyBinding {
  id: string
  action: HotkeyAction
  combination: HotkeyCombination | null
  enabled: boolean
}

export interface HotkeyActionDefinition {
  id: HotkeyAction
  label: string
  description: string
}

export const HOTKEY_ACTIONS: HotkeyActionDefinition[] = [
  { id: 'toggle-mute', label: 'Вкл./выкл. микрофон', description: 'Переключает ваш микрофон в голосовом канале.' },
  { id: 'toggle-deafen', label: 'Вкл./выкл. звук в наушниках', description: 'Отключает или возвращает входящий звук.' },
  { id: 'toggle-input-mode', label: 'Переключить режим ввода', description: 'Меняет голосовую активацию и режим рации.' },
  { id: 'toggle-screen-share', label: 'Вкл./выкл. демонстрацию экрана', description: 'Открывает выбор экрана или завершает текущую трансляцию.' },
  { id: 'disconnect-voice', label: 'Отключиться от голосового канала', description: 'Завершает текущее голосовое подключение.' },
  { id: 'open-voice-settings', label: 'Открыть настройки голоса', description: 'Открывает раздел «Голос и видео».' },
  { id: 'navigate-back', label: 'Перейти назад', description: 'Возвращает на предыдущую страницу.' },
  { id: 'navigate-forward', label: 'Перейти вперёд', description: 'Переходит на следующую страницу в истории.' },
]

const MODIFIER_CODES = new Set([
  'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight',
  'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight',
])

export function combinationFromKeyboardEvent(event: KeyboardEvent): HotkeyCombination | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null
  return {
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  }
}

export function serializeCombination(value: HotkeyCombination | null): string {
  if (!value) return ''
  return `${value.ctrl ? 1 : 0}${value.alt ? 1 : 0}${value.shift ? 1 : 0}${value.meta ? 1 : 0}:${value.code}`
}

function displayCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const labels: Record<string, string> = {
    Backquote: '`', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
    Comma: ',', Equal: '=', Minus: '-', Period: '.', Quote: "'", Semicolon: ';', Slash: '/',
    Space: 'Пробел', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Delete', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  }
  return labels[code] ?? code.replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function formatCombination(value: HotkeyCombination | null): string {
  if (!value) return 'Не назначено'
  const parts: string[] = []
  if (value.ctrl) parts.push('Ctrl')
  if (value.alt) parts.push('Alt')
  if (value.shift) parts.push('Shift')
  if (value.meta) parts.push('Win')
  parts.push(displayCode(value.code))
  return parts.join(' + ')
}

export function matchesCombination(event: KeyboardEvent, value: HotkeyCombination): boolean {
  return event.code === value.code
    && event.ctrlKey === value.ctrl
    && event.altKey === value.alt
    && event.shiftKey === value.shift
    && event.metaKey === value.meta
}

export function isEditableHotkeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function getConflictingHotkeyIds(bindings: HotkeyBinding[]): Set<string> {
  const groups = new Map<string, string[]>()
  bindings.filter((item) => item.enabled && item.combination).forEach((item) => {
    const key = serializeCombination(item.combination)
    groups.set(key, [...(groups.get(key) ?? []), item.id])
  })
  return new Set([...groups.values()].filter((ids) => ids.length > 1).flat())
}
