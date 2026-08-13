import type { TextChannelPermissionStatus } from '../../hooks/useTextChannelPermissions'

interface MessageComposerUnavailableProps {
  status: TextChannelPermissionStatus
  onRetry: () => void
}

export function MessageComposerUnavailable({ status, onRetry }: MessageComposerUnavailableProps) {
  const isLoading = status === 'loading'
  const isError = status === 'error'

  return (
    <div className="chat-area-composer flex-shrink-0 border-t border-border/70 p-3">
      <div
        className="flex min-h-[58px] min-w-0 items-center rounded-xl border border-gray-700 bg-gray-800 px-4 py-3 text-sm leading-5 text-text-quiet"
        role={isLoading ? 'status' : 'note'}
        aria-live={isLoading ? 'polite' : undefined}
      >
        <span className="min-w-0 flex-1 break-words">
          {isLoading && 'Проверяем права для этого канала…'}
          {(status === 'denied' || status === 'ready') && 'У вас недостаточно прав, чтобы отправлять сообщения на этом канале.'}
          {isError && 'Не удалось проверить права для этого канала.'}
        </span>
        {isError && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-3 min-h-9 flex-shrink-0 rounded-md px-3 font-semibold text-text-body transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Повторить
          </button>
        )}
      </div>
    </div>
  )
}
