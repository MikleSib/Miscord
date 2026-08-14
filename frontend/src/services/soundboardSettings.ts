const KEY = 'miscord:soundboard-settings:v1'

export interface SoundboardSettings { muted: boolean; volume: number }

export function getSoundboardSettings(): SoundboardSettings {
  if (typeof window === 'undefined') return { muted: false, volume: 0.8 }
  try {
    return { muted: false, volume: 0.8, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch { return { muted: false, volume: 0.8 } }
}

export function setSoundboardSettings(next: SoundboardSettings): void {
  localStorage.setItem(KEY, JSON.stringify(next))
  document.querySelectorAll<HTMLAudioElement>('audio[data-soundboard-audio="true"]').forEach(configureSoundboardAudio)
}

export function configureSoundboardAudio(audio: HTMLAudioElement): void {
  const settings = getSoundboardSettings()
  audio.dataset.soundboardAudio = 'true'
  audio.muted = settings.muted
  audio.volume = settings.volume
}
