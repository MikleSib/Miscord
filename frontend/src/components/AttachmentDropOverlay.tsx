import { PlusCircle } from 'lucide-react'

export function AttachmentDropOverlay({ direct = false }: { direct?: boolean }) {
  return (
    <div className={`pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-2xl border-2 border-dashed backdrop-blur-sm ${direct ? 'border-[#5865f2] bg-[#1e1f22]/90' : 'border-primary bg-background/90'}`}>
      <div className="text-center">
        <PlusCircle className="mx-auto mb-3 h-10 w-10 text-[#7c86ff]" />
        <p className="text-base font-semibold text-white">Добавить файлы в сообщение</p>
        <p className={`mt-1 text-sm ${direct ? 'text-[#b5bac1]' : 'text-muted-foreground'}`}>Изображения до 10 МиБ, остальные файлы до 20 МиБ</p>
      </div>
    </div>
  )
}
