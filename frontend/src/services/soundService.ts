import { getSoundEvent, type SoundEventId } from '../lib/soundEvents';
import { useSoundSettingsStore } from '../store/soundSettingsStore';

class SoundService {
  private joinSound: HTMLAudioElement | null = null;
  private leaveSound: HTMLAudioElement | null = null;
  private ringingSound: HTMLAudioElement | null = null;
  private callingSound: HTMLAudioElement | null = null;
  private streamStartSound: HTMLAudioElement | null = null;
  private streamEndSound: HTMLAudioElement | null = null;
  private streamJoinSound: HTMLAudioElement | null = null;
  private dmNotificationSound: HTMLAudioElement | null = null;
  private micOnSound: HTMLAudioElement | null = null;
  private micOffSound: HTMLAudioElement | null = null;
  private isInitialized: boolean = false;
  private previewAudio: HTMLAudioElement | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.initializeSounds();
  }

  private initializeSounds() {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      console.log('🔇 SoundService: Audio API недоступен (серверная среда)');
      return;
    }

    try {
      this.joinSound = new Audio('/music/звук подключения к звонку.mp3');
      this.joinSound.preload = 'auto';
      this.joinSound.volume = 0.35;

      this.leaveSound = new Audio('/music/звук отключения от звонка.mp3');
      this.leaveSound.preload = 'auto';
      this.leaveSound.volume = 0.35;

      this.ringingSound = new Audio('/music/звонок.mp3');
      this.ringingSound.preload = 'auto';
      this.ringingSound.loop = true;
      this.ringingSound.volume = 0.5;

      this.callingSound = new Audio('/music/звонок.mp3');
      this.callingSound.preload = 'auto';
      this.callingSound.loop = true;
      this.callingSound.volume = 0.5;

      this.streamStartSound = new Audio('/music/звук включения стрима.mp3');
      this.streamStartSound.preload = 'auto';
      this.streamStartSound.volume = 0.45;

      this.streamEndSound = new Audio('/music/звук выключения стрима.mp3');
      this.streamEndSound.preload = 'auto';
      this.streamEndSound.volume = 0.45;

      this.streamJoinSound = new Audio('/music/звук присоединения к стриму.mp3');
      this.streamJoinSound.preload = 'auto';
      this.streamJoinSound.volume = 0.45;

      this.dmNotificationSound = new Audio('/music/уведомление_sms.mp3');
      this.dmNotificationSound.preload = 'auto';
      this.dmNotificationSound.volume = 0.5;

      this.micOnSound = new Audio('/music/mic_on.mp3');
      this.micOnSound.preload = 'auto';
      this.micOnSound.volume = 0.45;

      this.micOffSound = new Audio('/music/mic_off.mp3');
      this.micOffSound.preload = 'auto';
      this.micOffSound.volume = 0.45;

      this.isInitialized = true;
    } catch (error) {
      console.error('🔊 Ошибка инициализации SoundService:', error);
    }
  }

  private playOneShot(
    audio: HTMLAudioElement | null,
    label: string,
    eventId: SoundEventId,
  ): void {
    if (!useSoundSettingsStore.getState().isEnabled(eventId)) return;
    if (!this.isInitialized || !audio) {
      console.warn(`🔊 SoundService: звук «${label}» недоступен`);
      return;
    }

    try {
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.error(`🔊 Ошибка воспроизведения «${label}»:`, error);
        });
      }
    } catch (error) {
      console.error(`🔊 Ошибка при воспроизведении «${label}»:`, error);
    }
  }

  playJoinSound() {
    this.playOneShot(this.joinSound, 'подключение к звонку', 'voice-join');
  }

  playLeaveSound() {
    this.playOneShot(this.leaveSound, 'отключение от звонка', 'voice-leave');
  }

  playIncomingCallSound() {
    if (!useSoundSettingsStore.getState().isEnabled('call-incoming')) return;
    if (!this.isInitialized || !this.ringingSound) {
      console.warn('🔊 SoundService не инициализирован или звук звонка недоступен');
      return;
    }
    try {
      this.ringingSound.currentTime = 0;
      this.ringingSound.play()?.catch((error) => {
        console.error('🔊 Ошибка воспроизведения звука звонка:', error);
      });
    } catch (error) {
      console.error('🔊 Ошибка при воспроизведении звука звонка:', error);
    }
  }

  playOutgoingCallSound() {
    this.playCallingSound();
  }

  playCallingSound() {
    if (!useSoundSettingsStore.getState().isEnabled('call-outgoing')) return;
    if (!this.isInitialized || !this.callingSound) return;
    try {
      this.callingSound.currentTime = 0;
      this.callingSound.play()?.catch((error) => {
        console.error('🔊 Ошибка воспроизведения звука вызова:', error);
      });
    } catch (error) {
      console.error('🔊 Ошибка при воспроизведении звука вызова:', error);
    }
  }

  /** Ведущий включил демонстрацию экрана. */
  playStreamStartSound() {
    this.playOneShot(this.streamStartSound, 'включение стрима', 'stream-start');
  }

  /** Ведущий выключил демонстрацию экрана. */
  playStreamEndSound() {
    this.playOneShot(this.streamEndSound, 'выключение стрима', 'stream-end');
  }

  /** Зритель открыл стрим или ведущий узнал о новом зрителе. */
  playStreamJoinSound() {
    this.playOneShot(this.streamJoinSound, 'присоединение к стриму', 'stream-join');
  }

  /** Новое личное сообщение (только у получателя). */
  playDmNotificationSound() {
    this.playOneShot(this.dmNotificationSound, 'уведомление SMS', 'message');
  }

  /** Включили микрофон. */
  playMicOnSound() {
    this.playOneShot(this.micOnSound, 'включение микрофона', 'mic-on');
  }

  /** Выключили микрофон. */
  playMicOffSound() {
    this.playOneShot(this.micOffSound, 'выключение микрофона', 'mic-off');
  }

  /** Звук по новому состоянию mute: true = выкл, false = вкл. */
  playMicToggleSound(isMuted: boolean) {
    if (isMuted) this.playMicOffSound();
    else this.playMicOnSound();
  }

  previewSound(eventId: SoundEventId): void {
    if (typeof Audio === 'undefined') return;
    this.stopPreview();
    const event = getSoundEvent(eventId);
    const audio = new Audio(event.source);
    audio.preload = 'auto';
    audio.volume = event.volume;
    this.previewAudio = audio;
    audio.play()?.catch((error) => {
      console.error(`🔊 Ошибка предпрослушивания «${event.label}»:`, error);
    });
    this.previewTimer = setTimeout(() => this.stopPreview(), 3000);
  }

  stopSound(eventId: SoundEventId): void {
    const audio = this.getAudio(eventId);
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }

  private stopPreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.currentTime = 0;
    }
    this.previewAudio = null;
  }

  private getAudio(eventId: SoundEventId): HTMLAudioElement | null {
    const audio: Record<SoundEventId, HTMLAudioElement | null> = {
      'voice-join': this.joinSound,
      'voice-leave': this.leaveSound,
      'call-incoming': this.ringingSound,
      'call-outgoing': this.callingSound,
      'stream-start': this.streamStartSound,
      'stream-end': this.streamEndSound,
      'stream-join': this.streamJoinSound,
      message: this.dmNotificationSound,
      'mic-on': this.micOnSound,
      'mic-off': this.micOffSound,
    };
    return audio[eventId];
  }

  stopAllSounds() {
    if (!this.isInitialized) return;
    try {
      this.stopPreview();
      for (const audio of [this.ringingSound, this.callingSound]) {
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
      }
    } catch (error) {
      console.error('🔊 Ошибка при остановке всех звуков:', error);
    }
  }

  setVolume(volume: number) {
    const clampedVolume = Math.max(0, Math.min(1, volume));

    for (const audio of [
      this.joinSound,
      this.leaveSound,
      this.ringingSound,
      this.callingSound,
      this.streamStartSound,
      this.streamEndSound,
      this.streamJoinSound,
      this.dmNotificationSound,
      this.micOnSound,
      this.micOffSound,
    ]) {
      if (audio) audio.volume = clampedVolume;
    }
  }

  isReady(): boolean {
    return (
      this.isInitialized &&
      this.joinSound !== null &&
      this.leaveSound !== null &&
      this.ringingSound !== null &&
      this.callingSound !== null
    );
  }
}

const soundService = new SoundService();

export default soundService;
