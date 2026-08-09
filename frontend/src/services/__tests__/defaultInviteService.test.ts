import { describe, expect, it, vi } from 'vitest'

import serverService from '../serverService'
import { getOrCreateDefaultInvite } from '../defaultInviteService'

vi.mock('../serverService', () => ({
  default: {
    createInvite: vi.fn(),
  },
}))

describe('default invite service', () => {
  it('deduplicates an in-flight request and permits a later backend reuse check', async () => {
    let resolveFirst!: (value: any) => void
    const firstResponse = new Promise<any>((resolve) => {
      resolveFirst = resolve
    })
    const createInvite = vi.mocked(serverService.createInvite)
    createInvite.mockReturnValueOnce(firstResponse)

    const first = getOrCreateDefaultInvite(123)
    const duplicate = getOrCreateDefaultInvite(123)

    expect(first).toBe(duplicate)
    expect(createInvite).toHaveBeenCalledTimes(1)
    expect(createInvite).toHaveBeenCalledWith(123, {
      max_age_seconds: 604800,
      max_uses: null,
      unique: false,
    })

    resolveFirst({ code: 'stable-code' })
    await first

    createInvite.mockResolvedValueOnce({ code: 'stable-code' } as any)
    await getOrCreateDefaultInvite(123)
    expect(createInvite).toHaveBeenCalledTimes(2)
  })
})
