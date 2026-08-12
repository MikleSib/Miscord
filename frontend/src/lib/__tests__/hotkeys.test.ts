import { describe, expect, it } from 'vitest'
import {
  combinationFromKeyboardEvent,
  formatCombination,
  getConflictingHotkeyIds,
  matchesCombination,
  serializeCombination,
  type HotkeyBinding,
} from '../hotkeys'

describe('hotkeys', () => {
  it('records and formats a physical key combination', () => {
    const event = {
      code: 'KeyM', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false,
    } as KeyboardEvent
    const combination = combinationFromKeyboardEvent(event)
    expect(combination).toEqual({ code: 'KeyM', ctrl: true, alt: false, shift: true, meta: false })
    expect(formatCombination(combination)).toBe('Ctrl + Shift + M')
    expect(serializeCombination(combination)).toBe('1010:KeyM')
    expect(matchesCombination(event, combination!)).toBe(true)
  })

  it('does not accept a modifier without a primary key', () => {
    const event = {
      code: 'ShiftLeft', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false,
    } as KeyboardEvent
    expect(combinationFromKeyboardEvent(event)).toBeNull()
  })

  it('marks every enabled duplicate as conflicting', () => {
    const combo = { code: 'Backslash', ctrl: false, alt: false, shift: false, meta: false }
    const bindings: HotkeyBinding[] = [
      { id: 'one', action: 'toggle-mute', combination: combo, enabled: true },
      { id: 'two', action: 'toggle-deafen', combination: combo, enabled: true },
      { id: 'disabled', action: 'navigate-back', combination: combo, enabled: false },
    ]
    expect([...getConflictingHotkeyIds(bindings)].sort()).toEqual(['one', 'two'])
  })
})
