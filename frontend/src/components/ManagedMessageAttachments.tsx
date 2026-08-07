import { Download, File, Music, Video } from 'lucide-react'
import { attachmentKind } from '../lib/chatAttachments'
import { resolveMediaUrl } from '../lib/mediaUrl'


interface ManagedAttachment {
  id: number
  file_url: string
  filename?: string | null
  content_type?: string | null
  size_bytes?: number | null
  description?: string | null
}


function sizeLabel(value = 0): string {
  if (value < 1024) return `${value} Б`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`
  return `${(value / 1024 / 1024).toFixed(1)} МБ`
}


export function ManagedMessageAttachments({ attachments }: { attachments: ManagedAttachment[] }) {
  const managed = (attachments || []).filter((item) => attachmentKind(item.content_type, item.file_url) !== 'image')
  if (!managed.length) return null
  return <div className="mt-2 grid max-w-[520px] gap-2">{managed.map((item) => {
    const url = resolveMediaUrl(item.file_url) || undefined
    const kind = attachmentKind(item.content_type, item.file_url)
    if (kind === 'audio') return <div key={item.id} className="rounded-xl bg-[#2b2d31] p-3"><div className="mb-2 flex min-w-0 items-center gap-2 text-sm text-[#dbdee1]"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#5865f2]/20 text-[#8b95ff]"><Music className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{item.filename || 'Аудио'}</span><span className="block text-xs text-[#949ba4]">{sizeLabel(item.size_bytes || 0)}</span></span><a href={url} download aria-label={`Скачать ${item.filename || 'аудио'}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[#b5bac1] hover:bg-white/10 hover:text-white"><Download className="h-4 w-4" /></a></div><audio controls preload="metadata" src={url} className="h-10 w-full" /></div>
    if (kind === 'video') return <div key={item.id} className="overflow-hidden rounded-lg bg-[#1e1f22]"><video controls preload="metadata" playsInline src={url} className="max-h-[360px] w-full" /><div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs text-[#b5bac1]"><Video className="h-4 w-4 shrink-0" /><span className="truncate">{item.filename || 'Видео'}</span><span className="ml-auto shrink-0">{sizeLabel(item.size_bytes || 0)}</span></div></div>
    return <a key={item.id} href={url} download className="flex min-w-0 items-center gap-3 rounded-lg bg-[#2b2d31] px-3 py-2.5 text-[#dbdee1] transition hover:bg-[#34363c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865f2]"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#1e1f22]"><File className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.filename || 'Файл'}</span><span className="block text-xs text-[#949ba4]">{sizeLabel(item.size_bytes || 0)}</span></span><Download className="h-4 w-4 shrink-0" /></a>
  })}</div>
}
