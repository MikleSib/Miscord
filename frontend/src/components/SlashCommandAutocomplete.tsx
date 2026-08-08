'use client'

import type { DiscordApplicationCommand } from '../types/bot'

export function SlashCommandAutocomplete({
  commands,
  selectedIndex,
  applicationNames,
  onSelect,
  onHover,
}: {
  commands: DiscordApplicationCommand[]
  selectedIndex: number
  applicationNames: Record<string, string>
  onSelect: (command: DiscordApplicationCommand) => void
  onHover: (index: number) => void
}) {
  if (!commands.length) return null
  return (
    <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-40 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-[#2b2d31] p-2 shadow-2xl shadow-black/40">
      <div className="px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-[#949ba4]">Команды приложений</div>
      {commands.map((command, index) => (
        <button
          key={`${command.application_id}-${command.id}`}
          type="button"
          onMouseDown={(event) => { event.preventDefault(); onSelect(command) }}
          onMouseEnter={() => onHover(index)}
          className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition ${index === selectedIndex ? 'bg-[#5865f2] text-white' : 'text-[#dbdee1] hover:bg-[#35373c]'}`}
        >
          <span className="font-semibold">/{command.name}</span>
          <span className={`min-w-0 flex-1 truncate text-sm ${index === selectedIndex ? 'text-white/80' : 'text-[#b5bac1]'}`}>{command.description}</span>
          <span className={`max-w-36 truncate text-xs ${index === selectedIndex ? 'text-white/70' : 'text-[#949ba4]'}`}>{applicationNames[command.application_id]}</span>
        </button>
      ))}
    </div>
  )
}
