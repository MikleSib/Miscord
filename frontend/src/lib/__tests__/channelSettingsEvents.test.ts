import { afterEach, describe, expect, it } from 'vitest'

import {
  requestChannelSettings,
  subscribeToChannelSettingsRequests,
} from '../channelSettingsEvents'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

describe('channel settings events', () => {
  it('передаёт точный канал существующему окну настроек', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: new EventTarget(),
    })
    const requests: Array<{ channelId: number; channelType: string }> = []
    const unsubscribe = subscribeToChannelSettingsRequests((detail) => requests.push(detail))

    requestChannelSettings({ id: 42, type: 'text' })
    unsubscribe()
    requestChannelSettings({ id: 99, type: 'voice' })

    expect(requests).toEqual([{ channelId: 42, channelType: 'text' }])
  })
})
