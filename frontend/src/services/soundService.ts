class SoundService {
  private joinSound: HTMLAudioElement | null = null;
  private leaveSound: HTMLAudioElement | null = null;
  private ringingSound: HTMLAudioElement | null = null;
  private callingSound: HTMLAudioElement | null = null;
  private isInitialized: boolean = false;

  constructor() {
    this.initializeSounds();
  }

  private initializeSounds() {
    // Проверяем, что мы в браузере (не на сервере)
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      console.log('🔇 SoundService: Audio API недоступен (серверная среда)');
      return;
    }

    try {
      // Инициализируем звук подключения
      this.joinSound = new Audio('/music/звук подключения к звонку.mp3');
      this.joinSound.preload = 'auto';
      this.joinSound.volume = 0.35; // Устанавливаем комфортную громкость
      
      // Инициализируем звук отключения
      this.leaveSound = new Audio('/music/звук отключения от звонка.mp3');
      this.leaveSound.preload = 'auto';
      this.leaveSound.volume = 0.35;
      
      this.ringingSound = new Audio('/music/звонок.mp3');
      this.ringingSound.preload = 'auto';
      this.ringingSound.loop = true;
      this.ringingSound.volume = 0.5;

      this.callingSound = new Audio('/music/звонок.mp3'); // Используем тот же звук
      this.callingSound.preload = 'auto';
      this.callingSound.loop = true;
      this.callingSound.volume = 0.5;

      this.isInitialized = true;
    } catch (error) {
      console.error('🔊 Ошибка инициализации SoundService:', error);
    }
  }

  playJoinSound() {
    if (!this.isInitialized || !this.joinSound) {
      console.warn('🔊 SoundService не инициализирован или звук подключения недоступен');
      return;
    }

    try {
      // Сбрасываем позицию воспроизведения на начало
      this.joinSound.currentTime = 0;
      
      // Воспроизводим звук
      const playPromise = this.joinSound.play();
      
      if (playPromise !== undefined) {
        playPromise.then(() => {
        }).catch(error => {
          console.error('🔊 Ошибка воспроизведения звука подключения:', error);
        });
      }
    } catch (error) {
      console.error('🔊 Ошибка при воспроизведении звука подключения:', error);
    }
  }

  playLeaveSound() {
    if (!this.isInitialized || !this.leaveSound) {
      console.warn('🔊 SoundService не инициализирован или звук отключения недоступен');
      return;
    }

    try {
      // Сбрасываем позицию воспроизведения на начало
      this.leaveSound.currentTime = 0;
      
      // Воспроизводим звук
      const playPromise = this.leaveSound.play();
      
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log('🔊 Звук отключения воспроизведен');
        }).catch(error => {
          console.error('🔊 Ошибка воспроизведения звука отключения:', error);
        });
      }
    } catch (error) {
      console.error('🔊 Ошибка при воспроизведении звука отключения:', error);
    }
  }

  playRingingSound() {
    if (!this.isInitialized || !this.ringingSound) {
      console.warn('🔊 SoundService не инициализирован или звук звонка недоступен');
      return;
    }

    try {
      this.ringingSound.currentTime = 0;
      const playPromise = this.ringingSound.play();

      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error('🔊 Ошибка воспроизведения звука звонка:', error);
        });
      }
    } catch (error) {
      console.error('🔊 Ошибка при воспроизведении звука звонка:', error);
    }
  }

  stopRingingSound() {
    if (!this.isInitialized || !this.ringingSound) {
      return;
    }
    
    try {
      this.ringingSound.pause();
      this.ringingSound.currentTime = 0;
    } catch (error) {
      console.error('🔊 Ошибка при остановке звука звонка:', error);
    }
  }

  playCallingSound() {
    if (!this.isInitialized || !this.callingSound) {
      console.warn('🔊 SoundService не инициализирован или звук вызова недоступен');
      return;
    }

    try {
      this.callingSound.currentTime = 0;
      const playPromise = this.callingSound.play();

      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error('🔊 Ошибка воспроизведения звука вызова:', error);
        });
      }
    } catch (error) {
      console.error('🔊 Ошибка при воспроизведении звука вызова:', error);
    }
  }

  stopCallingSound() {
    if (!this.isInitialized || !this.callingSound) {
      return;
    }
    
    try {
      this.callingSound.pause();
      this.callingSound.currentTime = 0;
    } catch (error) {
      console.error('🔊 Ошибка при остановке звука вызова:', error);
    }
  }

  // Метод для установки громкости звуков
  setVolume(volume: number) {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    
    if (this.joinSound) {
      this.joinSound.volume = clampedVolume;
    }
    
    if (this.leaveSound) {
      this.leaveSound.volume = clampedVolume;
    }

    if (this.ringingSound) {
      this.ringingSound.volume = clampedVolume;
    }

    if (this.callingSound) {
      this.callingSound.volume = clampedVolume;
    }
    
    console.log(`🔊 Громкость звуков установлена: ${Math.round(clampedVolume * 100)}%`);
  }

  // Метод для проверки готовности звуков
  isReady(): boolean {
    return this.isInitialized && this.joinSound !== null && this.leaveSound !== null && this.ringingSound !== null && this.callingSound !== null;
  }
}

// Создаем единственный экземпляр сервиса
const soundService = new SoundService();

export default soundService;
