'use client'

import { Accessibility, ExternalLink, MousePointer2 } from 'lucide-react'
import { Switch } from '../ui/switch'
import {
  CHAT_FONT_SIZES,
  MESSAGE_GROUP_SPACING,
  ZOOM_LEVELS,
  useAccessibilitySettingsStore,
  type InterfaceDensity,
  type MessageDisplay,
} from '../../store/accessibilitySettingsStore'

function SteppedSlider({
  label,
  description,
  options,
  value,
  suffix,
  onChange,
}: {
  label: string
  description: string
  options: readonly number[]
  value: number
  suffix: string
  onChange: (value: number) => void
}) {
  const index = Math.max(0, options.indexOf(value))
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-semibold text-foreground">{label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <output className="shrink-0 text-sm font-semibold text-primary">{value}{suffix}</output>
      </div>
      <div className="mt-4">
        <div className="flex justify-between px-0.5 text-[11px] font-medium text-muted-foreground" aria-hidden="true">
          {options.map((option) => <span key={option}>{option}{suffix}</span>)}
        </div>
        <input
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={index}
          onChange={(event) => onChange(options[Number(event.target.value)])}
          aria-label={label}
          aria-valuetext={`${value}${suffix}`}
          className="miscord-stepped-slider mt-2 w-full accent-primary"
        />
      </div>
    </div>
  )
}

function ToggleRow({ title, description, checked, onChange }: {
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-h-[72px] items-center gap-4 border-b border-border py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch variant="brand" checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  )
}

function RadioGroup<T extends string>({ label, description, value, options, onChange }: {
  label: string
  description: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <fieldset>
      <legend className="font-semibold text-foreground">{label}</legend>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-col gap-2.5">
        {options.map((option) => (
          <label key={option.value} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-white/[0.03]">
            <input type="radio" checked={value === option.value} onChange={() => onChange(option.value)} className="h-5 w-5 accent-primary" />
            <span className="font-medium text-foreground">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Preview() {
  const fontSize = useAccessibilitySettingsStore((state) => state.chatFontSize)
  const underline = useAccessibilitySettingsStore((state) => state.underlineLinks)
  const styledNames = useAccessibilitySettingsStore((state) => state.displayNameStyles)
  const compact = useAccessibilitySettingsStore((state) => state.messageDisplay === 'compact')
  const spacing = useAccessibilitySettingsStore((state) => state.messageGroupSpacing)
  return (
    <div className="rounded-lg border border-border bg-surface p-5" style={{ fontSize }}>
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Предпросмотр</p>
      <div className="flex gap-3">
        {!compact && <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-white">M</div>}
        <div className="min-w-0">
          <p><span className="font-semibold" style={{ color: styledNames ? '#da70d6' : undefined }}>Misha</span> <span className="ml-1 text-xs text-muted-foreground">11:59</span></p>
          <p className="leading-relaxed text-foreground">Так будут выглядеть сообщения и реакции.</p>
          <div className="mt-1 inline-flex rounded-md border border-primary/60 bg-primary/15 px-2 py-1 text-sm">🎈 3</div>
        </div>
      </div>
      <div className="flex gap-3" style={{ marginTop: spacing }}>
        {!compact && <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-white">M</div>}
        <div className="min-w-0">
          <p><span className="font-semibold" style={{ color: styledNames ? '#da70d6' : undefined }}>Misha</span> <span className="ml-1 text-xs text-muted-foreground">12:00</span></p>
          <p className="leading-relaxed">Ссылка на <a href="#accessibility-content" onClick={(event) => event.preventDefault()} className={underline ? 'text-link underline' : 'text-link'}>специальные возможности</a></p>
        </div>
      </div>
      <button type="button" className="mt-5 min-h-10 rounded-md bg-primary px-4 font-semibold text-white hover:bg-brand-hover"><MousePointer2 className="mr-2 inline h-4 w-4" />Пример кнопки</button>
    </div>
  )
}

export function AccessibilitySettings() {
  const state = useAccessibilitySettingsStore()
  return (
    <section id="accessibility-content" className="mx-auto w-full max-w-4xl pb-12">
      <div className="mb-6 flex items-center gap-3">
        <Accessibility className="h-6 w-6 text-primary" aria-hidden="true" />
        <div><h2 className="text-2xl font-semibold text-foreground">Специальные возможности</h2><p className="mt-1 text-sm text-muted-foreground">Настройте читаемость и плотность Miscord под себя.</p></div>
      </div>
      <Preview />

      <div className="mt-10 space-y-8">
        <section className="space-y-6">
          <h3 className="text-xl font-semibold text-foreground">Удобочитаемость</h3>
          <SteppedSlider label="Размер шрифта в чате" description="Меняет текст сообщений, не затрагивая остальной интерфейс." options={CHAT_FONT_SIZES} value={state.chatFontSize} suffix="px" onChange={state.setChatFontSize} />
          <div>
            <ToggleRow title="Всегда подчёркивать ссылки" description="Ссылки в сообщениях заметны даже без наведения." checked={state.underlineLinks} onChange={state.setUnderlineLinks} />
            <ToggleRow title="Показывать стили отображаемых имён" description="Использовать цвета ролей для имён участников." checked={state.displayNameStyles} onChange={state.setDisplayNameStyles} />
          </div>
        </section>

        <div className="h-px bg-border" />
        <section className="space-y-7">
          <h3 className="text-xl font-semibold text-foreground">Визуальная плотность</h3>
          <RadioGroup<InterfaceDensity> label="Плотность интерфейса" description="Меняет интервалы в списках серверов, каналов и участников." value={state.interfaceDensity} onChange={state.setInterfaceDensity} options={[{ value: 'compact', label: 'Компактная' }, { value: 'default', label: 'По умолчанию' }, { value: 'spacious', label: 'Просторная' }]} />
          <RadioGroup<MessageDisplay> label="Отображение сообщений в чате" description="Компактный режим скрывает аватары и уменьшает внутренние интервалы." value={state.messageDisplay} onChange={state.setMessageDisplay} options={[{ value: 'default', label: 'По умолчанию' }, { value: 'compact', label: 'Компактное' }]} />
          <SteppedSlider label="Расстояние между группами сообщений" description="Настраивает интервал при смене автора или после паузы." options={MESSAGE_GROUP_SPACING} value={state.messageGroupSpacing} suffix="px" onChange={state.setMessageGroupSpacing} />
          <SteppedSlider label="Уровень масштабирования" description="Меняет масштаб всего интерфейса. Также работают Ctrl +/− и Ctrl 0." options={ZOOM_LEVELS} value={state.zoomLevel} suffix="%" onChange={state.setZoomLevel} />
        </section>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground"><ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>Настройки хранятся локально и применяются сразу ко всем открытым разделам Miscord.</p></div>
      </div>
    </section>
  )
}
