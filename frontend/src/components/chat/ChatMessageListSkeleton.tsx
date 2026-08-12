const rows = [68, 46, 82, 58, 74]

export function ChatMessageListSkeleton() {
  return (
    <div className="space-y-5 py-3" role="status" aria-label="Загрузка сообщений">
      {rows.map((width, index) => (
        <div key={width} className="flex items-start gap-3" aria-hidden="true">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/[0.07] motion-reduce:animate-none" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <div className="h-3.5 w-28 animate-pulse rounded bg-white/[0.08] motion-reduce:animate-none" />
            <div
              className="h-3 animate-pulse rounded bg-white/[0.055] motion-reduce:animate-none"
              style={{ width: `${width}%`, animationDelay: `${index * 70}ms` }}
            />
            {index % 2 === 0 && (
              <div
                className="h-3 animate-pulse rounded bg-white/[0.045] motion-reduce:animate-none"
                style={{ width: `${Math.max(32, width - 24)}%`, animationDelay: `${index * 70 + 35}ms` }}
              />
            )}
          </div>
        </div>
      ))}
      <span className="sr-only">Загружаем историю сообщений…</span>
    </div>
  )
}
