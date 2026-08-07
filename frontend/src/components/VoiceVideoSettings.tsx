'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Headphones, Mic, Video } from 'lucide-react'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'
import { useAudioDeviceStore } from '../store/audioDeviceStore'
import { useNoiseSuppressionStore } from '../store/noiseSuppressionStore'
import { useVADSettingsStore } from '../store/vadSettingsStore'
import { audioProcessingService } from '../services/audioProcessingService'
import { MicTestSession, micTestNoiseModeFromStore } from '../services/micTestService'
import voiceService from '../services/voiceService'
import { cn } from '../lib/utils'
import type { NoiseSuppressionEngine } from '../store/noiseSuppressionStore'

type NoiseEngineChoice = 'miscord-ai' | 'deepfilternet3' | 'browser' | 'off'

type VoiceProfile = 'isolation' | 'studio' | 'custom'

function profileFromNoiseStore(): VoiceProfile {
  const { enabled, engine } = useNoiseSuppressionStore.getState()
  if (!enabled) return 'studio'
  if (engine === 'miscord-ai') return 'isolation'
  return 'custom'
}

interface MediaDeviceInfoLite {
  deviceId: string
  label: string
  kind: MediaDeviceKind
}

const selectClass =
  'w-full appearance-none rounded-md border-0 bg-[#1e1f22] px-3 py-2.5 pr-9 text-sm text-[#dbdee1] outline-none focus:ring-2 focus:ring-[#5865f2]'

export function VoiceVideoSettings() {
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfoLite[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfoLite[]>([])
  const [selectedInputDevice, setSelectedInputDevice] = useState('')
  const [selectedOutputDevice, setSelectedOutputDevice] = useState('')
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>(profileFromNoiseStore)
  const [echoCancellation, setEchoCancellation] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isTestingMicrophone, setIsTestingMicrophone] = useState(false)
  const [currentMicLevel, setCurrentMicLevel] = useState(0)
  const [liveMicLevel, setLiveMicLevel] = useState(0)
  const [isRecordingPttKey, setIsRecordingPttKey] = useState(false)

  const testingRef = useRef(false)
  const micTestRef = useRef(new MicTestSession())
  const selectedInputRef = useRef('')
  const selectedOutputRef = useRef('')
  const startMicrophoneTestRef = useRef<(() => Promise<void>) | null>(null)

  const inputVolume = useAudioDeviceStore((s) => s.inputVolume)
  const outputVolume = useAudioDeviceStore((s) => s.outputVolume)
  const setInputVolumeStore = useAudioDeviceStore((s) => s.setInputVolume)
  const setOutputVolumeStore = useAudioDeviceStore((s) => s.setOutputVolume)

  const noiseEnabled = useNoiseSuppressionStore((s) => s.enabled)
  const noiseEngine = useNoiseSuppressionStore((s) => s.engine)
  const setNoiseEnabled = useNoiseSuppressionStore((s) => s.setEnabled)
  const setNoiseEngine = useNoiseSuppressionStore((s) => s.setEngine)

  const restartMicTestIfActive = useCallback(async () => {
    if (!testingRef.current) return
    await startMicrophoneTestRef.current?.()
  }, [])

  const applyNoiseSettings = useCallback(
    async (enabled: boolean, engine: NoiseSuppressionEngine) => {
      setNoiseEnabled(enabled)
      if (enabled) {
        setNoiseEngine(engine)
      }
      await audioProcessingService.setNoiseSuppression(
        enabled,
        enabled ? engine : useNoiseSuppressionStore.getState().engine
      )
      await restartMicTestIfActive()
    },
    [restartMicTestIfActive, setNoiseEnabled, setNoiseEngine]
  )

  const applyProfileSettings = useCallback(
    async (profile: VoiceProfile) => {
      if (profile === 'isolation') {
        await applyNoiseSettings(true, 'miscord-ai')
      } else if (profile === 'studio') {
        await applyNoiseSettings(false, useNoiseSuppressionStore.getState().engine)
      }
    },
    [applyNoiseSettings]
  )

  const {
    inputMode,
    vadSensitivity,
    autoDetectSensitivity,
    pttKey,
    pttDelay,
    setInputMode,
    setVADSensitivity,
    setAutoDetectSensitivity,
    setPTTKey,
    setPTTDelay,
  } = useVADSettingsStore()

  const getPttKeyLabel = (key: string): string => {
    const keyMap: Record<string, string> = {
      Space: 'Пробел',
      ControlLeft: 'Левый Ctrl',
      ControlRight: 'Правый Ctrl',
      ShiftLeft: 'Левый Shift',
      ShiftRight: 'Правый Shift',
      AltLeft: 'Левый Alt',
      AltRight: 'Правый Alt',
      MetaLeft: 'Win',
      MetaRight: 'Win',
    }
    if (keyMap[key]) return keyMap[key]
    if (key.startsWith('Key')) return key.slice(3)
    if (key.startsWith('Digit')) return key.slice(5)
    return key
  }

  useEffect(() => {
    if (!isRecordingPttKey) return

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        setIsRecordingPttKey(false)
        return
      }
      setPTTKey(event.code)
      voiceService.setPTTKey(event.code)
      setIsRecordingPttKey(false)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isRecordingPttKey, setPTTKey])

  const loadDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter((d) => d.kind === 'audioinput')
      const outputs = devices.filter((d) => d.kind === 'audiooutput')
      setInputDevices(inputs)
      setOutputDevices(outputs)

      const storedInput = useAudioDeviceStore.getState().inputDeviceId
      const storedOutput = useAudioDeviceStore.getState().outputDeviceId
      const prevInput = selectedInputRef.current

      let nextInput = prevInput
      if (!nextInput || !inputs.some((d) => d.deviceId === nextInput)) {
        if (storedInput && storedInput !== 'default' && inputs.some((d) => d.deviceId === storedInput)) {
          nextInput = storedInput
        } else {
          nextInput = inputs[0]?.deviceId || ''
        }
      }

      let nextOutput = selectedOutputRef.current
      if (!nextOutput || !outputs.some((d) => d.deviceId === nextOutput)) {
        if (
          storedOutput &&
          storedOutput !== 'default' &&
          outputs.some((d) => d.deviceId === storedOutput)
        ) {
          nextOutput = storedOutput
        } else {
          nextOutput = outputs[0]?.deviceId || ''
        }
      }

      selectedInputRef.current = nextInput
      selectedOutputRef.current = nextOutput
      setSelectedInputDevice(nextInput)
      setSelectedOutputDevice(nextOutput)

      // USB отвалился: в голосовом канале восстанавливает voiceService,
      // здесь обновляем UI и перезапускаем проверку микрофона.
      if (prevInput && nextInput && prevInput !== nextInput) {
        useAudioDeviceStore.getState().setInputDeviceId(nextInput)
        if (testingRef.current) {
          window.setTimeout(() => {
            if (testingRef.current) void startMicrophoneTestRef.current?.()
          }, 350)
        }
      }
    } catch (error) {
      console.error('Ошибка получения устройств:', error)
    }
  }, [])

  useEffect(() => {
    void loadDevices()
    const onChange = () => void loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onChange)
      testingRef.current = false
      micTestRef.current.stop()
    }
  }, [loadDevices])

  useEffect(() => {
    selectedInputRef.current = selectedInputDevice
  }, [selectedInputDevice])

  useEffect(() => {
    selectedOutputRef.current = selectedOutputDevice
  }, [selectedOutputDevice])

  // Живой уровень для полоски чувствительности (если в голосовом канале)
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof voiceService.getCurrentVolume === 'function') {
        setLiveMicLevel(voiceService.getCurrentVolume() || 0)
      }
    }, 80)
    return () => window.clearInterval(timer)
  }, [])

  // Громкость самопрослушивания следует за слайдером динамика
  useEffect(() => {
    micTestRef.current.setOutputVolume(outputVolume)
  }, [outputVolume])

  // Профиль → шумодав (только по клику пользователя, не при открытии окна)
  const handleVoiceProfileSelect = (profile: VoiceProfile) => {
    setVoiceProfile(profile)
    if (profile !== 'custom') {
      void applyProfileSettings(profile)
    }
  }

  const handleInputVolumeChange = (values: number[]) => {
    const next = values[0] ?? 100
    setInputVolumeStore(next)
    voiceService.setInputVolume(next)
  }

  const handleOutputVolumeChange = (values: number[]) => {
    const next = values[0] ?? 100
    setOutputVolumeStore(next)
    voiceService.setOutputVolume(next)
  }

  const stopMicrophoneTest = () => {
    testingRef.current = false
    setIsTestingMicrophone(false)
    setCurrentMicLevel(0)
    micTestRef.current.stop()
  }

  const startMicrophoneTest = useCallback(async () => {
    testingRef.current = true
    setIsTestingMicrophone(true)
    setCurrentMicLevel(0)

    const noiseState = useNoiseSuppressionStore.getState()

    try {
      await micTestRef.current.start({
        inputDeviceId: selectedInputDevice || undefined,
        outputDeviceId: selectedOutputDevice || undefined,
        noiseMode: micTestNoiseModeFromStore(noiseState.enabled, noiseState.engine),
        inputVolume,
        outputVolume,
        onLevel: (level) => {
          if (!testingRef.current) return
          setCurrentMicLevel(level)
        },
        onInputEnded: () => {
          void loadDevices().then(() => {
            if (testingRef.current) {
              void startMicrophoneTestRef.current?.()
            }
          })
        },
      })
    } catch (error) {
      console.error('Ошибка проверки микрофона:', error)
      if (testingRef.current) {
        stopMicrophoneTest()
        alert('Не удалось получить доступ к микрофону')
      }
    }
  }, [selectedInputDevice, selectedOutputDevice, inputVolume, outputVolume, loadDevices])

  startMicrophoneTestRef.current = startMicrophoneTest

  const handleMicrophoneTest = async () => {
    if (testingRef.current) {
      stopMicrophoneTest()
      return
    }
    await startMicrophoneTest()
  }

  // Перезапуск при смене устройств/громкости микрофона во время проверки
  useEffect(() => {
    if (!testingRef.current) return
    void restartMicTestIfActive()
  }, [selectedInputDevice, selectedOutputDevice, inputVolume, restartMicTestIfActive])

  const applyNoiseEngine = async (engine: NoiseEngineChoice) => {
    if (engine === 'off') {
      await applyNoiseSettings(false, noiseEngine)
      return
    }
    await applyNoiseSettings(true, engine)
  }

  const handleInputDeviceChange = async (deviceId: string) => {
    setSelectedInputDevice(deviceId)
    useAudioDeviceStore.getState().setInputDeviceId(deviceId || 'default')
    try {
      await voiceService.switchInputDevice(deviceId)
    } catch (error) {
      console.warn('Не удалось сменить микрофон в голосовом канале:', error)
    }
  }

  const handleOutputDeviceChange = async (deviceId: string) => {
    setSelectedOutputDevice(deviceId)
    useAudioDeviceStore.getState().setOutputDeviceId(deviceId || 'default')
    try {
      await voiceService.setOutputDevice(deviceId)
    } catch (error) {
      console.warn('Не удалось сменить динамик:', error)
    }
  }

  const deviceLabel = (device: MediaDeviceInfoLite, kind: 'mic' | 'speaker') =>
    device.label ||
    `${kind === 'mic' ? 'Микрофон' : 'Динамик'} ${device.deviceId.slice(0, 8)}…`

  const meterLevel = isTestingMicrophone ? currentMicLevel : liveMicLevel
  const barCount = 32
  const activeBars = Math.round((meterLevel / 100) * barCount)

  const noiseSelectValue = !noiseEnabled
    ? 'off'
    : noiseEngine === 'deepfilternet3'
      ? 'deepfilternet3'
      : noiseEngine === 'browser'
        ? 'browser'
        : 'miscord-ai'

  return (
    <div className="mx-auto max-w-[720px] space-y-8 pb-8">
      {/* —— Голос —— */}
      <section>
        <h3 className="mb-4 text-xl font-semibold text-[#f2f3f5]">Голос</h3>

        {/* Устройства: микрофон | динамик */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
              Микрофон
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#b5bac1]">
                <Mic className="h-4 w-4" />
              </span>
              <select
                value={selectedInputDevice}
                onChange={(e) => void handleInputDeviceChange(e.target.value)}
                className={cn(selectClass, 'pl-9')}
              >
                {inputDevices.length === 0 ? (
                  <option value="">Нет устройств</option>
                ) : (
                  inputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {deviceLabel(d, 'mic')}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b5bac1]" />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
              Динамик
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#b5bac1]">
                <Headphones className="h-4 w-4" />
              </span>
              <select
                value={selectedOutputDevice}
                onChange={(e) => void handleOutputDeviceChange(e.target.value)}
                className={cn(selectClass, 'pl-9')}
              >
                {outputDevices.length === 0 ? (
                  <option value="">Нет устройств</option>
                ) : (
                  outputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {deviceLabel(d, 'speaker')}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b5bac1]" />
            </div>
          </div>
        </div>

        {/* Громкости рядом */}
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-3 block text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
              Громкость микрофона
            </label>
            <Slider
              value={[inputVolume]}
              onValueChange={handleInputVolumeChange}
              min={0}
              max={100}
              step={1}
            />
          </div>
          <div>
            <label className="mb-3 block text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
              Громкость динамика
            </label>
            <Slider
              value={[outputVolume]}
              onValueChange={handleOutputVolumeChange}
              min={0}
              max={100}
              step={1}
            />
          </div>
        </div>

        {/* Проверка микрофона + полоски */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void handleMicrophoneTest()}
            className={cn(
              'shrink-0 rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-colors',
              isTestingMicrophone
                ? 'bg-[#da373c] hover:bg-[#a12828]'
                : 'bg-[#5865f2] hover:bg-[#4752c4]'
            )}
          >
            {isTestingMicrophone ? 'Остановить проверку' : 'Проверка микрофона'}
          </button>
          <div
            className="flex h-8 flex-1 items-end gap-[3px] rounded-md bg-[#1e1f22]/80 px-2 py-1.5"
            aria-hidden="true"
          >
            {Array.from({ length: barCount }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'w-[3px] flex-1 rounded-sm transition-colors duration-75',
                  i < activeBars
                    ? i < barCount * 0.7
                      ? 'bg-[#23a559]'
                      : i < barCount * 0.9
                        ? 'bg-[#f0b232]'
                        : 'bg-[#f23f43]'
                    : 'bg-[#4e5058]'
                )}
                style={{ height: `${35 + (i % 5) * 12}%` }}
              />
            ))}
          </div>
        </div>

        <p className="mt-3 text-sm text-[#949ba4]">
          Нужна помощь? Загляните в руководство по устранению неполадок.
        </p>
      </section>

      <hr className="border-[#3f4147]" />

      {/* —— Профиль ввода —— */}
      <section>
        <h3 className="mb-4 text-xl font-semibold text-[#f2f3f5]">Профиль ввода</h3>
        <div className="space-y-4">
          {(
            [
              {
                id: 'isolation' as const,
                title: 'Изоляция голоса',
                desc: 'Только ваш прекрасный голос: Miscord AI уберёт ненужный шум',
              },
              {
                id: 'studio' as const,
                title: 'Студия',
                desc: 'Чистый звук: открытый микрофон без обработки',
              },
              {
                id: 'custom' as const,
                title: 'Пользовательский',
                desc: 'Продвинутый режим: мне нужны все кнопки и переключатели!',
              },
            ] as const
          ).map((item) => {
            const selected = voiceProfile === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleVoiceProfileSelect(item.id)}
                className="flex w-full items-start gap-3 text-left"
              >
                <span
                  className={cn(
                    'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2',
                    selected ? 'border-[#5865f2]' : 'border-[#80848e]'
                  )}
                  aria-hidden="true"
                >
                  {selected && <span className="h-2.5 w-2.5 rounded-full bg-[#5865f2]" />}
                </span>
                <span>
                  <span className="block text-[15px] font-medium text-[#f2f3f5]">{item.title}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-[#949ba4]">{item.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Чувствительность */}
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-medium text-[#f2f3f5]">
              Автоматически определять чувствительность ввода
            </p>
            <p className="mt-1 text-sm text-[#949ba4]">
              Контролирует чувствительность к звукам вашего микрофона в Miscord.
            </p>
          </div>
          <Switch
            variant="brand"
            checked={autoDetectSensitivity}
            onCheckedChange={setAutoDetectSensitivity}
            aria-label="Автоматическая чувствительность"
          />
        </div>

        {!autoDetectSensitivity && (
          <div className="pt-1">
            <div className="relative h-2.5 overflow-hidden rounded-full bg-[#1e1f22]">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: '100%',
                  background:
                    'linear-gradient(90deg, #f0b232 0%, #f0b232 35%, #23a559 55%, #23a559 100%)',
                }}
              />
              {/* индикатор текущего уровня */}
              <div
                className="absolute inset-y-0 left-0 bg-black/35"
                style={{ width: `${100 - meterLevel}%`, marginLeft: `${meterLevel}%` }}
              />
            </div>
            <Slider
              value={[vadSensitivity]}
              onValueChange={(v) => {
                const next = v[0] ?? 50
                setVADSensitivity(next)
                voiceService.updateVADThresholds(next)
              }}
              min={0}
              max={100}
              step={1}
              className="mt-3"
            />
          </div>
        )}
      </section>

      <hr className="border-[#3f4147]" />

      {/* Строки как на втором референсе */}
      <section className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium text-[#f2f3f5]">Шумоподавление</p>
            <p className="mt-1 text-sm text-[#949ba4]">
              Уменьшает фоновый шум микрофона. Предоставляется Miscord AI.
            </p>
          </div>
          <div className="relative w-[11.5rem] shrink-0">
            <select
              value={noiseSelectValue}
              onChange={(e) => {
                const value = e.target.value as NoiseEngineChoice
                void applyNoiseEngine(value)
                if (value !== 'miscord-ai') setVoiceProfile('custom')
                if (value === 'miscord-ai') setVoiceProfile('isolation')
                if (value === 'off') setVoiceProfile('studio')
              }}
              className={selectClass}
            >
              <option value="miscord-ai">Miscord AI</option>
              <option value="deepfilternet3">DeepFilterNet3</option>
              <option value="browser">Стандартное</option>
              <option value="off">Выключено</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#b5bac1]" />
          </div>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-medium text-[#f2f3f5]">Эхоподавление</p>
            <p className="mt-1 text-sm text-[#949ba4]">
              Убирает эхо от динамиков, чтобы вас не было слышно дважды.
            </p>
          </div>
          <Switch
            variant="brand"
            checked={echoCancellation}
            onCheckedChange={(checked) => {
              setEchoCancellation(checked)
              void voiceService.updateAudioSettings({ echoCancellation: checked })
            }}
            aria-label="Эхоподавление"
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[15px] font-medium text-[#f2f3f5]">Режим рации</p>
            <Switch
              variant="brand"
              checked={inputMode === 'push-to-talk'}
              onCheckedChange={(checked) => {
                setInputMode(checked ? 'push-to-talk' : 'voice-activity')
                voiceService.setInputMode(checked ? 'push-to-talk' : 'voice-activity')
                if (!checked) setIsRecordingPttKey(false)
              }}
              aria-label="Режим рации"
            />
          </div>

          {inputMode === 'push-to-talk' && (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 pr-3">
                  <p className="text-[15px] font-medium text-[#f2f3f5]">
                    Горячая клавиша для режима рации
                  </p>
                  <p className="mt-1 text-sm leading-snug text-[#949ba4]">
                    Вы можете добавить несколько комбинаций для режима рации в настройках горячих
                    клавиш.
                  </p>
                </div>
                <div className="flex h-10 w-[15.5rem] shrink-0 items-stretch overflow-hidden rounded-md bg-[#1e1f22]">
                  <div className="flex min-w-0 flex-1 items-center px-3 text-sm text-[#949ba4]">
                    <span className="truncate">
                      {isRecordingPttKey
                        ? 'Нажмите клавишу…'
                        : pttKey
                          ? getPttKeyLabel(pttKey)
                          : 'Горячие клавиши не назначены'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsRecordingPttKey(true)}
                    className={cn(
                      'shrink-0 border-l border-[#2b2d31] px-3 text-sm font-medium transition-colors',
                      isRecordingPttKey
                        ? 'bg-[#5865f2] text-white'
                        : 'text-[#dbdee1] hover:bg-[#2b2d31]'
                    )}
                  >
                    {isRecordingPttKey ? 'Ожидание…' : 'Установить'}
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-3 text-[15px] font-medium text-[#f2f3f5]">
                  Задержка отключения в режиме рации
                </p>
                <Slider
                  value={[pttDelay]}
                  onValueChange={(values) => {
                    const next = values[0] ?? 20
                    setPTTDelay(next)
                    voiceService.setPTTDelay(next)
                  }}
                  min={0}
                  max={2000}
                  step={20}
                />
                <p className="mt-2 text-xs text-[#949ba4]">
                  {pttDelay === 0
                    ? 'Без задержки'
                    : `${(pttDelay / 1000).toFixed(pttDelay % 1000 === 0 ? 0 : 2)} сек.`}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-medium text-[#f2f3f5]">
              Показать расширенные настройки голоса
            </p>
            <p className="mt-1 text-sm text-[#949ba4]">
              Автоматическая регулировка усиления и тонкая настройка активации по голосу.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#1e1f22] text-[#dbdee1] hover:bg-[#2b2d31]"
            aria-expanded={showAdvanced}
            aria-label="Расширенные настройки"
          >
            <ChevronDown
              className={cn('h-5 w-5 transition-transform', showAdvanced && 'rotate-180')}
            />
          </button>
        </div>

        {showAdvanced && (
          <div className="rounded-md border border-[#3f4147] bg-[#1e1f22]/50 p-4 space-y-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[#b5bac1]">
              Расширенные настройки
            </p>
            <div>
              <label className="mb-2 block text-sm text-[#dbdee1]">
                Чувствительность активации по голосу: {vadSensitivity}%
              </label>
              <Slider
                value={[vadSensitivity]}
                onValueChange={(v) => {
                  const next = v[0] ?? 50
                  setVADSensitivity(next)
                  setAutoDetectSensitivity(false)
                  voiceService.updateVADThresholds(next)
                }}
                min={0}
                max={100}
                step={1}
              />
            </div>
            <p className="text-xs text-[#949ba4]">
              Miscord AI обрабатывает звук локально на вашем устройстве.
            </p>
          </div>
        )}
      </section>

      <hr className="border-[#3f4147]" />

      {/* —— Камера —— */}
      <section>
        <h3 className="mb-4 text-xl font-semibold text-[#f2f3f5]">Камера</h3>
        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-[#1e1f22]">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-md bg-[#5865f2] px-4 py-2.5 text-sm font-semibold text-white opacity-70"
            title="Скоро"
          >
            <Video className="h-4 w-4" />
            Проверить видео
          </button>
        </div>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-medium text-[#f2f3f5]">Предпросмотр видео (всегда)</p>
            <p className="mt-1 text-sm text-[#949ba4]">
              Использовать предпросмотр каждый раз, как вы включаете видео
            </p>
          </div>
          <Switch
            variant="brand"
            checked={false}
            disabled
            onCheckedChange={() => {}}
            aria-label="Предпросмотр видео"
          />
        </div>
      </section>
    </div>
  )
}
