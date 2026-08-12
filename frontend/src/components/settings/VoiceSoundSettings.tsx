'use client'

import { useState } from 'react'
import { ChevronDown, Volume2 } from 'lucide-react'
import { SOUND_EVENTS, type SoundEventDefinition } from '../../lib/soundEvents'
import soundService from '../../services/soundService'
import { useSoundSettingsStore } from '../../store/soundSettingsStore'
import { cn } from '../../lib/utils'
import { Switch } from '../ui/switch'

function SoundRow({ event }: { event: SoundEventDefinition }) {
  const checked = useSoundSettingsStore((state) => state.enabled[event.id] !== false)
  const setEnabled = useSoundSettingsStore((state) => state.setEnabled)

  return (
    <div className="flex min-h-[78px] items-center gap-4 border-b border-[#3f4147] py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[#dbdee1]">{event.label}</p>
        <p className="mt-0.5 text-sm leading-5 text-[#949ba4]">{event.description}</p>
        <button
          type="button"
          onClick={() => soundService.previewSound(event.id)}
          className="mt-1 text-sm font-medium text-[#6d8cff] outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-[#5865f2]"
        >
          Послушать звук
        </button>
      </div>
      <Switch
        variant="brand"
        checked={checked}
        onCheckedChange={(enabled) => {
          setEnabled(event.id, enabled)
          if (!enabled) soundService.stopSound(event.id)
        }}
        aria-label={`${checked ? 'Отключить' : 'Включить'} звук «${event.label}»`}
      />
    </div>
  )
}

export function VoiceSoundSettings() {
  const [expanded, setExpanded] = useState(false)
  const featured = SOUND_EVENTS.filter((event) => event.featured)
  const additional = SOUND_EVENTS.filter((event) => !event.featured)

  return (
    <>
      <div className="my-10 h-px bg-[#3f4147]" />
      <section aria-labelledby="voice-sounds-heading">
        <div className="mb-3 flex items-center gap-3">
          <Volume2 className="h-5 w-5 text-[#b5bac1]" aria-hidden="true" />
          <h3 id="voice-sounds-heading" className="text-xl font-semibold text-white">Звуки</h3>
        </div>
        <p className="mb-2 max-w-2xl text-sm leading-5 text-[#949ba4]">
          Выберите системные сигналы Miscord. Настройки сохраняются на этом устройстве.
        </p>

        <div>{featured.map((event) => <SoundRow key={event.id} event={event} />)}</div>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="additional-voice-sounds"
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 flex min-h-12 w-full items-center justify-between gap-4 rounded-md px-1 text-left outline-none hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-[#5865f2]"
        >
          <span>
            <span className="block font-semibold text-[#dbdee1]">
              {expanded ? 'Скрыть дополнительные звуки' : `Показать ещё ${additional.length} звуков`}
            </span>
            <span className="mt-0.5 block text-sm text-[#949ba4]">
              Сообщения, звонки и демонстрация экрана.
            </span>
          </span>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[#3f4147]">
            <ChevronDown
              className={cn('h-5 w-5 transition-transform duration-200 motion-reduce:transition-none', expanded && 'rotate-180')}
              aria-hidden="true"
            />
          </span>
        </button>

        {expanded && (
          <div id="additional-voice-sounds" className="mt-2 border-t border-[#3f4147]">
            {additional.map((event) => <SoundRow key={event.id} event={event} />)}
          </div>
        )}
      </section>
    </>
  )
}
