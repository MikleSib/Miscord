import { describe, expect, it } from 'vitest'

import { voiceJoinErrorMessage } from '../voiceJoinErrors'

describe('voiceJoinErrorMessage', () => {
  it('turns an inactive Stage protocol error into an actionable message', () => {
    expect(voiceJoinErrorMessage({ code: 'stage_not_active' })).toBe(
      'Сцена ещё не запущена. Модератор должен сначала начать Stage.',
    )
  })

  it('preserves a server message for unknown error codes', () => {
    expect(voiceJoinErrorMessage({ code: 'custom', message: 'Повторите позже' })).toBe('Повторите позже')
  })
})
