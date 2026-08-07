export const MAX_CHAT_ATTACHMENTS = 10
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_CHAT_VIDEO_BYTES = 20 * 1024 * 1024
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v)$/i
const AUDIO_EXTENSIONS = /\.(mp3|ogg|oga|wav|flac|m4a|aac)$/i
const IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export type ChatAttachmentKind = 'image' | 'video' | 'audio' | 'file'

export function chatAttachmentKind(file: File): ChatAttachmentKind {
  if (IMAGE_CONTENT_TYPES.has(file.type.toLowerCase())) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (IMAGE_EXTENSIONS.test(file.name)) return 'image'
  if (VIDEO_EXTENSIONS.test(file.name)) return 'video'
  if (AUDIO_EXTENSIONS.test(file.name)) return 'audio'
  return 'file'
}

export function attachmentKind(contentType: string | null | undefined, url: string): ChatAttachmentKind {
  const normalizedType = contentType?.toLowerCase().split(';', 1)[0]
  if (normalizedType && IMAGE_CONTENT_TYPES.has(normalizedType)) return 'image'
  if (normalizedType?.startsWith('video/')) return 'video'
  if (normalizedType?.startsWith('audio/')) return 'audio'
  const path = url.split(/[?#]/, 1)[0]
  if (IMAGE_EXTENSIONS.test(path)) return 'image'
  if (VIDEO_EXTENSIONS.test(path)) return 'video'
  if (AUDIO_EXTENSIONS.test(path)) return 'audio'
  return 'file'
}

export function isVideoAttachment(contentType: string | null | undefined, url: string): boolean {
  return attachmentKind(contentType, url) === 'video'
}

export function isImageAttachment(contentType: string | null | undefined, url: string): boolean {
  return attachmentKind(contentType, url) === 'image'
}

export function isAudioAttachment(contentType: string | null | undefined, url: string): boolean {
  return attachmentKind(contentType, url) === 'audio'
}

export function appendChatFiles(current: File[], incoming: File[]): { files: File[]; error: string | null } {
  const accepted: File[] = []
  let error: string | null = null

  for (const file of incoming) {
    if (file.size === 0) {
      error = 'Пустые файлы нельзя прикрепить к сообщению.'
      continue
    }
    const kind = chatAttachmentKind(file)
    const limit = kind === 'image' ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_FILE_BYTES
    if (file.size > limit) {
      error = kind === 'image'
        ? 'Размер одного изображения не должен превышать 10 МиБ.'
        : 'Размер одного файла не должен превышать 20 МиБ.'
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
