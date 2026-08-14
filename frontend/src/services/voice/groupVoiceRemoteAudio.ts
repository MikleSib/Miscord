import { configureSoundboardAudio } from '../soundboardSettings';
import type { RemoteMedia } from './types';

const AUDIO_SOURCES = new Set(['microphone', 'screen-audio', 'soundboard']);

export function attachGroupVoiceAudio(options: {
  media: RemoteMedia;
  elements: Map<string, HTMLAudioElement>;
  participantVolume: number;
  outputVolume: number;
  applyOutputDevice: () => void;
}): void {
  const { media, elements } = options;
  if (!AUDIO_SOURCES.has(media.source)) return;
  const key = media.source === 'soundboard'
    ? `${media.userId}:${media.source}:${media.stream.id}`
    : `${media.userId}:${media.source}`;
  const audio = elements.get(key) ?? document.createElement('audio');
  audio.id = `remote-audio-${media.userId}-${media.source}`;
  audio.autoplay = true;
  audio.srcObject = media.stream;
  audio.volume = options.participantVolume * options.outputVolume / 100;
  if (media.source === 'soundboard') configureSoundboardAudio(audio);
  elements.set(key, audio);
  if (media.source === 'soundboard') {
    const cleanup = () => {
      if (elements.get(key) !== audio) return;
      audio.srcObject = null;
      audio.remove();
      elements.delete(key);
    };
    media.stream.getTracks().forEach((track) => track.addEventListener('ended', cleanup, { once: true }));
  }
  options.applyOutputDevice();
  void audio.play().catch(() => undefined);
}
