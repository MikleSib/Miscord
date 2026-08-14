import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../api', () => ({
  default: { get: mocks.get },
}))
vi.mock('../uploadService', () => ({
  default: {},
}))

describe('expressionService sound audio', () => {
  beforeEach(() => mocks.get.mockReset())

  it('loads protected audio through the authorized API client and caches it', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    mocks.get.mockResolvedValueOnce({ data: bytes })
    const service = (await import('../expressionService')).default

    expect(Array.from(new Uint8Array(await service.soundAudio(991)))).toEqual([1, 2, 3])
    expect(Array.from(new Uint8Array(await service.soundAudio(991)))).toEqual([1, 2, 3])
    expect(mocks.get).toHaveBeenCalledOnce()
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/expressions/991/audio', {
      responseType: 'arraybuffer',
    })
  })
})
