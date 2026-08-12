import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class AudioMock {
  static instances: AudioMock[] = []
  currentTime = 0
  loop = false
  preload = ''
  volume = 1
  play = vi.fn(async () => undefined)
  pause = vi.fn()

  constructor(public readonly src: string) {
    AudioMock.instances.push(this)
  }
}

describe('sound preferences', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    AudioMock.instances = []
    vi.stubGlobal('window', {})
    vi.stubGlobal('Audio', AudioMock)
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('blocks a disabled event but still allows explicit preview', async () => {
    const { useSoundSettingsStore } = await import('../../store/soundSettingsStore')
    const soundService = (await import('../soundService')).default
    const micOn = AudioMock.instances.find((audio) => audio.src.endsWith('/mic_on.mp3'))!

    soundService.playMicOnSound()
    expect(micOn.play).toHaveBeenCalledOnce()

    useSoundSettingsStore.getState().setEnabled('mic-on', false)
    soundService.playMicOnSound()
    expect(micOn.play).toHaveBeenCalledOnce()

    soundService.previewSound('mic-on')
    const preview = AudioMock.instances.at(-1)!
    expect(preview).not.toBe(micOn)
    expect(preview.play).toHaveBeenCalledOnce()
  })
})
