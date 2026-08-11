import { Hash, Pencil } from 'lucide-react'

interface ChannelWelcomeProps {
  channelName: string
  canManage: boolean
  onConfigure: () => void
}

export function ChannelWelcome({ channelName, canManage, onConfigure }: ChannelWelcomeProps) {
  return (
    <section className="channel-welcome pb-2 pt-5 sm:pt-7" aria-labelledby="channel-welcome-title">
      <div className="mb-3 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-surface text-foreground sm:h-[72px] sm:w-[72px]">
        <Hash className="h-10 w-10" strokeWidth={2.5} aria-hidden="true" />
      </div>

      <h1
        id="channel-welcome-title"
        className="max-w-[28ch] text-balance text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-foreground sm:text-[32px]"
      >
        Добро пожаловать на канал #{channelName}!
      </h1>
      <p className="mt-2 text-[15px] leading-5 text-text-body">
        Это начало канала #{channelName}.
      </p>

      {canManage && (
        <button
          type="button"
          onClick={onConfigure}
          className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-md bg-surface-raised px-3 text-sm font-semibold text-text-body transition-colors hover:bg-[#3a3c43] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Настроить канал
        </button>
      )}
    </section>
  )
}
