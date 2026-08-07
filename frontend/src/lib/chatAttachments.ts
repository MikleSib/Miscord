export const MAX_CHAT_ATTACHMENTS = 10
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_CHAT_VIDEO_BYTES = 20 * 1024 * 1024

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v)$/i

export type ChatMediaKind = 'image' | 'video'

export function chatMediaKind(file: File): ChatMediaKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (IMAGE_EXTENSIONS.test(file.name)) return 'image'
  if (VIDEO_EXTENSIONS.test(file.name)) return 'video'
  return null
}

export function isVideoAttachment(contentType: string | null | undefined, url: string): boolean {
  if (contentType?.startsWith('video/')) return true
  const path = url.split(/[?#]/, 1)[0]
  return VIDEO_EXTENSIONS.test(path)
}

export function appendChatFiles(current: File[], incoming: File[]): { files: File[]; error: string | null } {
  const accepted: File[] = []
  let error: string | null = null

  for (const file of incoming) {
    const kind = chatMediaKind(file)
    if (!kind) {
      error = 'Поддерживаются изображения PNG, JPEG, GIF, WEBP и видео MP4, WebM, MOV.'
      continue
    }
    const limit = kind === 'video' ? MAX_CHAT_VIDEO_BYTES : MAX_CHAT_IMAGE_BYTES
    if (file.size > limit) {
      error = kind === 'video'
        ? 'Размер одного видео не должен превышать 20 МиБ.'
        : 'Размер одного изображения не должен превышать 10 МиБ.'
      continue
    }
    if (current.length + accepted.length >= MAX_CHAT_ATTACHMENTS) {
      error = `К одному сообщению можно прикрепить не более ${MAX_CHAT_ATTACHMENTS} файлов.`
      break
    }
    accepted.push(file)
  }

  return { files: [...current, ...accepted], error }
}
