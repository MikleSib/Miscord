import { describe, expect, it } from 'vitest'

import type { DirectMessage } from '../types'
import {
  formatDirectMessageTime,
  isDirectMessageGroupStart,
  needsDirectMessageDateSeparator,
} from './directMessageTimeline'

function message(id: number, senderId: number, timestamp: string): DirectMessage {
  return { id, sender_id: senderId, recipient_id: 2, content: 'Текст', timestamp }
}

describe('direct message timeline', () => {
  it('groups consecutive messages by one author inside seven minutes', () => {
    const first = message(1, 1, '2026-08-13T10:00:00Z')
    const next = message(2, 1, '2026-08-13T10:06:59Z')

    expect(isDirectMessageGroupStart(next, first)).toBe(false)
    expect(needsDirectMessageDateSeparator(next, first)).toBe(false)
  })

  it('starts a new group for another author, day, or a long pause', () => {
    const first = message(1, 1, '2026-08-13T10:00:00Z')

    expect(isDirectMessageGroupStart(message(2, 2, '2026-08-13T10:01:00Z'), first)).toBe(true)
    expect(isDirectMessageGroupStart(message(3, 1, '2026-08-13T10:08:00Z'), first)).toBe(true)
    expect(needsDirectMessageDateSeparator(message(4, 1, '2026-08-14T00:01:00Z'), first)).toBe(true)
  })

  it('formats compact message time', () => {
    expect(formatDirectMessageTime('2026-08-13T10:05:00')).toBe('10:05')
  })
})
