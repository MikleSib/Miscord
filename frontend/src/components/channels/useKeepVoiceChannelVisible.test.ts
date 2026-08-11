import { describe, expect, it } from 'vitest'

import { getVoiceChannelScrollDelta } from './useKeepVoiceChannelVisible'

describe('getVoiceChannelScrollDelta', () => {
  const scroller = { top: 48, bottom: 900 }

  it('keeps a visible channel in place', () => {
    expect(getVoiceChannelScrollDelta(scroller, { top: 160, bottom: 196 }, 700)).toBe(0)
  })

  it('moves a channel above an overlapping user dock', () => {
    expect(getVoiceChannelScrollDelta(scroller, { top: 680, bottom: 716 }, 700)).toBe(28)
  })

  it('restores a channel hidden above the scroll viewport', () => {
    expect(getVoiceChannelScrollDelta(scroller, { top: 40, bottom: 76 }, 700)).toBe(-20)
  })

  it('uses the full viewport when the dock does not overlap', () => {
    expect(getVoiceChannelScrollDelta(scroller, { top: 840, bottom: 876 }, null)).toBe(0)
  })
})
