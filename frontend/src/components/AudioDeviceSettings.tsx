'use client'

import React, { useState, useEffect } from 'react';
import { Mic, Volume2, RefreshCw } from 'lucide-react';
import { Slider } from './ui/slider';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';
import { useAudioDeviceStore } from '../store/audioDeviceStore';
import voiceService from '../services/voiceService';

interface MediaDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

interface AudioDeviceSettingsProps {
  className?: string;
}

export const AudioDeviceSettings: React.FC<AudioDeviceSettingsProps> = ({ className }) => {
  const [inputDevices, setInputDevices] = useState<MediaDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDevice[]>([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>('');
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const inputVolume = useAudioDeviceStore((s) => s.inputVolume);
  const outputVolume = useAudioDeviceStore((s) => s.outputVolume);
  const setInputVolumeStore = useAudioDeviceStore((s) => s.setInputVolume);
  const setOutputVolumeStore = useAudioDeviceStore((s) => s.setOutputVolume);
  const [voiceProfile, setVoiceProfile] = useState('voice-activity');
  const [isTestingMicrophone, setIsTestingMicrophone] = useState(false);
  const [currentMicLevel, setCurrentMicLevel] = useState(0);
  const [testStream, setTestStream] = useState<MediaStream | null>(null);
  const [testAudioContext, setTestAudioContext] = useState<AudioContext | null>(null);

  const handleInputVolumeChange = (values: number[]) => {
    const next = values[0] ?? 100;
    setInputVolumeStore(next);
    voiceService.setInputVolume(next);
  };

  const handleOutputVolumeChange = (values: number[]) => {
    const next = values[0] ?? 100;
    setOutputVolumeStore(next);
    voiceService.setOutputVolume(next);
  };

  // Получаем список устройств
  const loadDevices = async () => {
    setIsLoading(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const inputs = devices.filter(device => device.kind === 'audioinput');
      const outputs = devices.filter(device => device.kind === 'audiooutput');

      setInputDevices(inputs);
      setOutputDevices(outputs);

      // Устанавливаем устройства по умолчанию
      if (inputs.length > 0 && !selectedInputDevice) {
        setSelectedInputDevice(inputs[0].deviceId);
      }
      if (outputs.length > 0 && !selectedOutputDevice) {
        setSelectedOutputDevice(outputs[0].deviceId);
      }
    } catch (error) {
      console.error('Ошибка получения устройств:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();

    // Обновляем список устройств при изменении устройств
    const handleDeviceChange = () => {
      loadDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);

      // Очищаем ресурсы тестирования микрофона при размонтировании
      if (testStream) {
        testStream.getTracks().forEach(track => track.stop());
      }
      if (testAudioContext && testAudioContext.state !== 'closed') {
        testAudioContext.close();
      }
    };
  }, []);

  const handleInputDeviceChange = (deviceId: string) => {
    setSelectedInputDevice(deviceId);
    // Здесь можно добавить логику для смены устройства ввода
    console.log('Выбрано устройство ввода:', deviceId);
  };

  const handleOutputDeviceChange = (deviceId: string) => {
    setSelectedOutputDevice(deviceId);
    // Здесь можно добавить логику для смены устройства вывода
    console.log('Выбрано устройство вывода:', deviceId);
  };

  const handleMicrophoneTest = async () => {
    if (isTestingMicrophone) {
      // Останавливаем тестирование
      stopMicrophoneTest();
      return;
    }

    try {
      // Запрашиваем доступ к микрофону для теста
      const constraints = {
        audio: {
          deviceId: selectedInputDevice ? { exact: selectedInputDevice } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };

      console.log('Запрос микрофона с параметрами:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      console.log('Получен поток:', stream);
      console.log('Треки:', stream.getTracks());

      const audioTrack = stream.getAudioTracks()[0];
      console.log('Аудио трек:', audioTrack);
      console.log('Настройки трека:', audioTrack.getSettings());

      // Создаем AudioContext для анализа звука
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);

      // Настраиваем анализатор для анализа временной области
      analyser.fftSize = 256; // Минимальный размер для быстрого отклика
      analyser.smoothingTimeConstant = 0.1; // Минимальное сглаживание для чувствительности
      const bufferLength = analyser.fftSize / 2;
      const dataArray = new Float32Array(bufferLength);

      // Сохраняем ссылки для возможности остановки
      setTestStream(stream);
      setTestAudioContext(audioContext);
      setIsTestingMicrophone(true);
      setCurrentMicLevel(0);

      // Функция для расчета уровня громкости (простой расчет)
      const calculateSimpleLevel = (buffer: Float32Array): number => {
        // Находим максимальное абсолютное значение в буфере
        let max = 0;
        for (let i = 0; i < buffer.length; i++) {
          const abs = Math.abs(buffer[i]);
          if (abs > max) max = abs;
        }

        // Нормируем максимум к 0-100% (максимум для речи обычно ~0.3-0.5)
        return Math.min(100, (max / 0.5) * 100);
      };

      // Функция для визуализации уровня звука
      const updateVisualization = () => {
        if (!isTestingMicrophone) return;

        analyser.getFloatTimeDomainData(dataArray);

        // Вычисляем уровень громкости используя простой расчет
        const level = calculateSimpleLevel(dataArray);

        console.log('Текущий уровень микрофона:', level, 'буфер:', dataArray.slice(0, 5));

        setCurrentMicLevel(level);

        // Продолжаем мониторинг если пользователь все еще тестирует
        if (isTestingMicrophone && stream.active) {
          requestAnimationFrame(updateVisualization);
        }
      };

      // Даем время на инициализацию микрофона перед началом анализа
      setTimeout(() => {
        if (isTestingMicrophone) {
          updateVisualization();
        }
      }, 100);

      console.log('Тест микрофона запущен');

    } catch (error) {
      console.error('Ошибка при тестировании микрофона:', error);
      alert('Не удалось получить доступ к микрофону для тестирования');
    }
  };

  const stopMicrophoneTest = () => {
    setIsTestingMicrophone(false);
    setCurrentMicLevel(0);

    // Останавливаем поток и контекст
    if (testStream) {
      testStream.getTracks().forEach(track => track.stop());
      setTestStream(null);
    }

    if (testAudioContext && testAudioContext.state !== 'closed') {
      testAudioContext.close();
      setTestAudioContext(null);
    }

    console.log('Тест микрофона остановлен');
  };

  const getDeviceLabel = (device: MediaDevice) => {
    return device.label || `${device.kind === 'audioinput' ? 'Микрофон' : 'Динамик'} ${device.deviceId.slice(0, 8)}...`;
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Устройство ввода */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Mic className="w-4 h-4 text-primary" />
          <label className="text-sm font-medium text-foreground">Устройство ввода</label>
        </div>

        <div className="relative">
          <select
            value={selectedInputDevice}
            onChange={(e) => handleInputDeviceChange(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            disabled={isLoading || inputDevices.length === 0}
          >
            {inputDevices.length === 0 ? (
              <option value="">Нет доступных устройств</option>
            ) : (
              inputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {getDeviceLabel(device)}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Громкость микрофона */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Mic className="w-4 h-4 text-primary" />
          <label className="text-sm font-medium text-foreground">Громкость микрофона</label>
        </div>

        <div className="bg-secondary p-4 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-foreground">Громкость: {inputVolume}%</span>
            <div className="flex space-x-2">
              <span className="text-xs text-muted-foreground">Низкая</span>
              <span className="text-xs text-muted-foreground">Высокая</span>
            </div>
          </div>

          <Slider
            value={[inputVolume]}
            onValueChange={handleInputVolumeChange}
            min={0}
            max={100}
            step={1}
            className="w-full"
          />
        </div>
      </div>

      {/* Устройство вывода */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Volume2 className="w-4 h-4 text-primary" />
          <label className="text-sm font-medium text-foreground">Устройство вывода</label>
        </div>

        <div className="relative">
          <select
            value={selectedOutputDevice}
            onChange={(e) => handleOutputDeviceChange(e.target.value)}
            className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            disabled={isLoading || outputDevices.length === 0}
          >
            {outputDevices.length === 0 ? (
              <option value="">Нет доступных устройств</option>
            ) : (
              outputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {getDeviceLabel(device)}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Громкость звука */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Volume2 className="w-4 h-4 text-primary" />
          <label className="text-sm font-medium text-foreground">Громкость звука</label>
        </div>

        <div className="bg-secondary p-4 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-foreground">Громкость: {outputVolume}%</span>
            <div className="flex space-x-2">
              <span className="text-xs text-muted-foreground">Низкая</span>
              <span className="text-xs text-muted-foreground">Высокая</span>
            </div>
          </div>

          <Slider
            value={[outputVolume]}
            onValueChange={handleOutputVolumeChange}
            min={0}
            max={100}
            step={1}
            className="w-full"
          />
        </div>
      </div>

      {/* Профиль ввода */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Mic className="w-4 h-4 text-primary" />
          <label className="text-sm font-medium text-foreground">Профиль ввода</label>
        </div>

        <div className="bg-secondary p-4 rounded-lg border border-border">
          <RadioGroup value={voiceProfile} onValueChange={setVoiceProfile}>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="voice-activity" id="voice-activity" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="voice-activity" className="text-foreground font-medium cursor-pointer">
                  Изоляция голоса
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Только ваш прекрасный голос. Discord удалит ненужный шум
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 mt-3">
              <RadioGroupItem value="studio" id="studio" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="studio" className="text-foreground font-medium cursor-pointer">
                  Студия
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Чистый звук: открытый микрофон без обработки
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 mt-3">
              <RadioGroupItem value="user" id="user" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="user" className="text-foreground font-medium cursor-pointer">
                  Пользовательский
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Продвинутый режим: мне нужны все кнопки и переключатели!
                </p>
              </div>
            </div>
          </RadioGroup>

          {/* Режим ввода (показывается только для пользовательского профиля) */}
          {voiceProfile === 'user' && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="text-sm font-medium text-foreground mb-3">Режим ввода</h4>
              <RadioGroup value="voice-activity" onValueChange={() => {}}>
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="voice-activity" id="input-voice-activity" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="input-voice-activity" className="text-foreground font-medium cursor-pointer">
                      Активация по голосу
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Микрофон автоматически включается при обнаружении речи
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 mt-3">
                  <RadioGroupItem value="push-to-talk" id="input-push-to-talk" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="input-push-to-talk" className="text-foreground font-medium cursor-pointer">
                      Режим рации
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Микрофон включается только при нажатии клавиши
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>
      </div>

      {/* Кнопка обновления устройств */}
      <div className="flex justify-between items-center pt-2 border-t border-border">
        <button
          onClick={loadDevices}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1 text-sm text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent rounded-md transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Обновить устройства
        </button>

        <div className="text-xs text-muted-foreground">
          Найдено: {inputDevices.length} микрофонов, {outputDevices.length} динамиков
        </div>
      </div>

      {/* Тест микрофона */}
      <div className="bg-secondary p-4 rounded-lg border border-border">
        <h4 className="text-sm font-medium text-foreground mb-3">Проверка микрофона</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Проблемы с микрофоном? Начните проверку и скажите какую-нибудь ерунду — мы тут же её воспроизведём.
        </p>

        {/* Индикатор уровня громкости во время тестирования */}
        {isTestingMicrophone && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Воспроизводим ваш прекрасный голос</span>
              <span className="text-xs text-muted-foreground">{Math.round(currentMicLevel)}%</span>
            </div>
            <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-100"
                style={{ width: `${currentMicLevel}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleMicrophoneTest}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            isTestingMicrophone
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {isTestingMicrophone ? 'Прекратить проверку' : 'Давайте проверим'}
        </button>
      </div>

      {/* Помощь */}
      <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
        <h4 className="text-sm font-medium text-blue-300 mb-2">Нужна помощь с голосовым или видеочатом?</h4>
        <p className="text-xs text-blue-200">
          Ознакомьтесь с нашим руководством по устранению неполадок.
        </p>
      </div>
    </div>
  );
};
