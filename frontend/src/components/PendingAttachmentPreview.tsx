'use client'

import { useEffect, useState } from 'react'
import { Video, X } from 'lucide-react'
import { chatMediaKind } from '../lib/chatAttachments'

function sizeLabel(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} КБ`
    : `${(size / 1024 / 1024).toFixed(1)} МБ`
}

export function PendingAttachmentPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState('')
  const isVideo = chatMediaKind(file) === 'video'

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return (
    <div className="group relative w-24 shrink-0 overflow-hidden rounded-lg border border-[#4b4d55] bg-[#2b2d31]">
      <div className="relative h-20 bg-[#1e1f22]">
        {url && (isVideo ? (
          <video src={url} muted preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <img src={url} alt={file.name} className="h-full w-full object-cover" />
        ))}
        {isVideo && (
          <span className="absolute bottom-1 left-1 grid h-6 w-6 place-items-center rounded bg-black/70 text-white">
            <Video className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="px-2 py-1.5">
        <p className="truncate text-[11px] font-medium text-[#dbdee1]" title={file.name}>{file.name}</p>
        <p className="text-[10px] text-[#949ba4]">{sizeLabel(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Убрать ${file.name}`}
        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/75 text-white transition hover:bg-[#da373c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
