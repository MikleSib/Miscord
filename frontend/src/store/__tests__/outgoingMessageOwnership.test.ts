import { describe, expect, it } from 'vitest'
import { OutgoingMessageOwnership } from '../outgoingMessageOwnership'

describe('OutgoingMessageOwnership', () => {
  it('lets a non-leader tab send the messages created in that tab', () => {
    const ownership = new OutgoingMessageOwnership()
    ownership.setLeader(false)
    ownership.claim('local-message')

    expect(ownership.isLeader()).toBe(false)
    expect(ownership.canProcess('local-message')).toBe(true)
    expect(ownership.canProcess('restored-message')).toBe(false)
  })

  it('lets the elected leader process restored messages and releases local ownership', () => {
    const ownership = new OutgoingMessageOwnership()
    ownership.setLeader(false)
    ownership.claim('local-message')
    ownership.release('local-message')

    expect(ownership.canProcess('local-message')).toBe(false)
    ownership.setLeader(true)
    expect(ownership.canProcess('restored-message')).toBe(true)
  })

  it('drops all ownership when a user session ends', () => {
    const ownership = new OutgoingMessageOwnership()
    ownership.claim('local-message')
    ownership.clear()

    expect(ownership.canProcess('local-message')).toBe(false)
  })
})
