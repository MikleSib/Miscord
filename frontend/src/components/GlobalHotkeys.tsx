'use client'

import { useEffect } from 'react'
import { getConflictingHotkeyIds, isEditableHotkeyTarget, matchesCombination } from '../lib/hotkeys'
import { openUserSettings } from '../lib/userSettingsNavigation'
import voiceService from '../services/voiceService'
import voiceSettingsController from '../services/voiceSettingsController'
import { useHotkeyStore } from '../store/hotkeyStore'
import { useScreenSharePickerStore } from '../store/screenSharePickerStore'
import { useVoiceStore } from '../store/slices/voiceSlice'
import { useVADSettingsStore } from '../store/vadSettingsStore'
import type { HotkeyAction } from '../lib/hotkeys'

function runHotkeyAction(action: HotkeyAction): void {
  const voice = useVoiceStore.getState()
  if (action === 'toggle-mute' && voice.isConnected) voice.toggleMute()
  if (action === 'toggle-deafen' && voice.isConnected) voice.toggleDeafen()
  if (action === 'disconnect-voice' && voice.isConnected) voice.disconnectFromVoiceChannel()
  if (action === 'toggle-input-mode') {
    const current = useVADSettingsStore.getState().inputMode
    voiceSettingsController.setInputMode(current === 'voice-activity' ? 'push-to-talk' : 'voice-activity')
  }
  if (action === 'toggle-screen-share' && voice.isConnected) {
    if (voiceService.getScreenSharingStatus()) voiceService.stopScreenShare()
    else useScreenSharePickerStore.getState().open()
  }
  if (action === 'open-voice-settings') openUserSettings('voice')
  if (action === 'navigate-back') window.history.back()
  if (action === 'navigate-forward') window.history.forward()
}

export function GlobalHotkeys() {
  const bindings = useHotkeyStore((state) => state.bindings)
  const suspended = useHotkeyStore((state) => state.suspended)

  useEffect(() => {
    const conflicts = getConflictingHotkeyIds(bindings)
    const active = bindings.filter((binding) => binding.enabled && binding.combination && !conflicts.has(binding.id))
    const onKeyDown = (event: KeyboardEvent) => {
      if (suspended || event.repeat || event.isComposing || isEditableHotkeyTarget(event.target)) return
      const binding = active.find((item) => item.combination && matchesCombination(event, item.combination))
      if (!binding) return
      event.preventDefault()
      event.stopPropagation()
      runHotkeyAction(binding.action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bindings, suspended])

  return null
}

export { runHotkeyAction }
