import soundService from '../soundService';

export type ScreenShareSound = 'start' | 'join' | 'stop';

export function playScreenShareSound(sound: ScreenShareSound): void {
  if (sound === 'start') soundService.playStreamStartSound();
  else if (sound === 'join') soundService.playStreamJoinSound();
  else soundService.playStreamEndSound();
}
