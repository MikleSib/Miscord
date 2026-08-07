'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Check,
  ChevronRight,
  Headphones,
  Mic,
  Monitor,
  Settings,
  Speaker,
} from 'lucide-react'
import voiceSettingsController from '../services/voiceSettingsController'
import { useAudioDeviceStore } from '../store/audioDeviceStore'
import { cn } from '../lib/utils'

type VoiceDeviceKind = 'input' | 'output'

interface AudioDeviceOption {
  deviceId: string
  label: string
  kind: MediaDeviceKind
}

interface VoiceDevicePopoverProps {
  kind: VoiceDeviceKind
  open: boolean
  onClose: () => void
  onSettingsClick?: () => void
}

const fallbackLabel = (kind: VoiceDeviceKind, index: number) =>
  `${kind === 'input' ? 'Микрофон' : 'Устройство вывода'} ${index + 1}`

const cleanDeviceLabel = (label: string) =>
  label.replace(/^Default\s*-\s*/i, '').replace(/^Communications\s*-\s*/i, '').trim()

export function VoiceDevicePopover({
  kind,
  open,
  onClose,
  onSettingsClick,
}: VoiceDevicePopoverProps) {
  const [devices, setDevices] = useState<AudioDeviceOption[]>([])
  const [showDevices, setShowDevices] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputDeviceId = useAudioDeviceStore((state) => state.inputDeviceId)
  const outputDeviceId = useAudioDeviceStore((state) => state.outputDeviceId)
  const inputVolume = useAudioDeviceStore((state) => state.inputVolume)
  const outputVolume = useAudioDeviceStore((state) => state.outputVolume)

  const selectedDeviceId = kind === 'input' ? inputDeviceId : outputDeviceId
  const volume = kind === 'input' ? inputVolume : outputVolume
  const mediaKind: MediaDeviceKind = kind === 'input' ? 'audioinput' : 'audiooutput'

  useEffect(() => {
    if (!open) return

    let cancelled = false
    const loadDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setError('Браузер не поддерживает выбор аудиоустройств')
        return
      }

      setIsLoading(true)
      setError(null)
      try {
        const available = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const nextDevices = available
          .filter((device) => device.kind === mediaKind)
          .map((device, index) => ({
            deviceId: device.deviceId,
            kind: device.kind,
            label: cleanDeviceLabel(device.label) || fallbackLabel(kind, index),
          }))
        setDevices(nextDevices)
      } catch {
        if (!cancelled) setError('Не удалось получить список устройств')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    setShowDevices(true)
    void loadDevices()
    const handleDeviceChange = () => void loadDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange)
    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
    }
  }, [kind, mediaKind, open])

  const options = useMemo<AudioDeviceOption[]>(() => {
    const withoutDefault = devices.filter((device) => device.deviceId !== 'default')
    return [
      { deviceId: 'default', label: 'Системное устройство', kind: mediaKind },
      ...withoutDefault,
    ]
  }, [devices, mediaKind])

  const selectedDevice = options.find((device) => device.deviceId === selectedDeviceId) ?? options[0]

  const selectDevice = async (deviceId: string) => {
    setError(null)
    try {
      if (kind === 'input') {
        await voiceSettingsController.setInputDevice(deviceId)
      } else {
        await voiceSettingsController.setOutputDevice(deviceId)
      }
      setShowDevices(false)
    } catch {
      setError('Устройство недоступно. Проверьте подключение и разрешения.')
    }
  }

  const changeVolume = (nextVolume: number) => {
    if (kind === 'input') {
      voiceSettingsController.setInputVolume(nextVolume)
      return
    }
    voiceSettingsController.setOutputVolume(nextVolume)
  }

  if (!open) return null

  const isInput = kind === 'input'

  return (
    <div
      className="voice-device-popover"
      role="dialog"
      aria-label={isInput ? 'Настройки микрофона' : 'Настройки устройства вывода'}
    >
      <button
        type="button"
        className={cn('voice-device-popover__device-trigger', showDevices && 'is-active')}
        onClick={() => setShowDevices((visible) => !visible)}
        onPointerEnter={() => setShowDevices(true)}
        aria-expanded={showDevices}
      >
        <span className="voice-device-popover__device-copy">
          <strong>{isInput ? 'Устройство ввода' : 'Устройство вывода'}</strong>
          <span title={selectedDevice.label}>{selectedDevice.label}</span>
        </span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="voice-device-popover__divider" />

      <label className="voice-device-popover__volume">
        <span>
          {isInput ? 'Громкость микрофона' : 'Громкость звука'}
          <output>{volume}%</output>
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={volume}
          onChange={(event) => changeVolume(Number(event.target.value))}
          className="voice-device-popover__range"
          style={{ '--voice-volume': `${volume}%` } as CSSProperties}
          aria-label={isInput ? 'Громкость микрофона' : 'Громкость звука'}
        />
      </label>

      <div className="voice-device-popover__divider" />

      <button
        type="button"
        className="voice-device-popover__settings"
        onClick={() => {
          onClose()
          onSettingsClick?.()
        }}
      >
        <span>Настройки голоса</span>
        <Settings className="h-5 w-5" aria-hidden="true" />
      </button>

      {error && <p className="voice-device-popover__error" role="status">{error}</p>}

      {showDevices && (
        <div className="voice-device-popover__devices" role="radiogroup" aria-label="Аудиоустройства">
          {isLoading && devices.length === 0 ? (
            <p className="voice-device-popover__empty">Ищем устройства...</p>
          ) : (
            options.map((device, index) => {
              const selected = device.deviceId === selectedDeviceId || (
                device.deviceId === 'default' && !options.some((option) => option.deviceId === selectedDeviceId)
              )
              const label = device.label || fallbackLabel(kind, index)
              const outputIcon = /head|науш/i.test(label)
                ? Headphones
                : /monitor|display|hdmi/i.test(label)
                  ? Monitor
                  : Speaker
              const DeviceIcon = isInput ? Mic : outputIcon
              return (
                <button
                  key={`${device.deviceId}-${index}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn('voice-device-popover__device-option', selected && 'is-selected')}
                  onClick={() => void selectDevice(device.deviceId)}
                >
                  <DeviceIcon className="h-[18px] w-[18px]" aria-hidden="true" />
                  <span title={label}>{label}</span>
                  <i aria-hidden="true">{selected && <Check className="h-3 w-3" />}</i>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
