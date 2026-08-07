import { RichWebhookEmbed } from '../types/webhook'
import { resolveMediaUrl } from '../lib/mediaUrl'


function external(url?: string): string | undefined {
  return url ? resolveMediaUrl(url) : undefined
}


export function RichMessageEmbeds({ embeds }: { embeds: RichWebhookEmbed[] }) {
  if (!embeds?.length) return null
  return (
    <div className="mt-2 grid max-w-[540px] gap-2">
      {embeds.map((embed, index) => {
        const accent = typeof embed.color === 'number' ? `#${embed.color.toString(16).padStart(6, '0')}` : '#5865f2'
        return (
          <article key={`${embed.url || embed.title || 'embed'}-${index}`} className="relative min-w-0 overflow-hidden rounded-lg bg-[#2b2d31] px-4 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: accent }} />
            {embed.author && (
              <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-medium text-[#dbdee1]">
                {embed.author.icon_url && <img src={external(embed.author.icon_url)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full object-cover" />}
                {embed.author.url ? <a href={embed.author.url} target="_blank" rel="noreferrer" className="truncate hover:underline">{embed.author.name}</a> : <span className="truncate">{embed.author.name}</span>}
              </div>
            )}
            {embed.title && (embed.url ? <a href={embed.url} target="_blank" rel="noreferrer" className="block break-words font-semibold text-[#00a8fc] hover:underline">{embed.title}</a> : <h3 className="break-words font-semibold text-white">{embed.title}</h3>)}
            {embed.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-[#dbdee1]">{embed.description}</p>}
            {!!embed.fields?.length && <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-3">{embed.fields.map((field, fieldIndex) => <div key={`${field.name}-${fieldIndex}`} className={`min-w-0 ${field.inline ? '' : 'sm:col-span-3'}`}><div className="break-words text-xs font-semibold text-white">{field.name}</div><div className="mt-0.5 whitespace-pre-wrap break-words text-sm text-[#dbdee1]">{field.value}</div></div>)}</div>}
            {embed.thumbnail?.url && <img src={external(embed.thumbnail.url)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="mt-3 max-h-40 max-w-40 rounded-md object-contain" />}
            {embed.image?.url && <img src={external(embed.image.url)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="mt-3 max-h-[360px] w-auto max-w-full rounded-md object-contain" />}
            {embed.footer && <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-[#b5bac1]">{embed.footer.icon_url && <img src={external(embed.footer.icon_url)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-5 w-5 rounded-full object-cover" />}<span className="break-words">{embed.footer.text}</span>{embed.timestamp && <span aria-hidden>•</span>}{embed.timestamp && <time dateTime={embed.timestamp}>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(embed.timestamp))}</time>}</div>}
          </article>
        )
      })}
    </div>
  )
}

