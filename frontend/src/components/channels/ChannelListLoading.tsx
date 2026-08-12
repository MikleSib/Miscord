export function ChannelListLoading() {
  return (
    <div
      className="space-y-5 px-3 py-4"
      role="status"
      aria-live="polite"
      aria-label="Загрузка категорий и каналов"
    >
      {[0, 1, 2].map((group) => (
        <div key={group} className="space-y-2.5">
          <div className="h-3 w-24 animate-pulse rounded bg-secondary" />
          {[0, 1].map((row) => (
            <div key={row} className="flex h-8 items-center gap-2 px-2">
              <div className="h-4 w-4 animate-pulse rounded bg-secondary" />
              <div
                className="h-3 animate-pulse rounded bg-secondary"
                style={{ width: `${58 + ((group + row) % 3) * 12}%` }}
              />
            </div>
          ))}
        </div>
      ))}
      <span className="sr-only">Загружаем структуру сервера…</span>
    </div>
  )
}
