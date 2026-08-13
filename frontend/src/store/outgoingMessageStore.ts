import axios from 'axios'
import { create } from 'zustand'
import { clearOutgoingRecords, deleteOutgoingRecord, loadOutgoingRecords, PersistedOutgoingRecord, saveOutgoingRecord } from '../lib/outgoingMessageDb'
import uploadService, { UploadedChatFile } from '../services/uploadService'
import unifiedWebSocketService from '../services/unifiedWebSocketService'
import { useChatStore } from './chatStore'
import { applyOutgoingMessageAck } from './outgoingMessageAck'
import { OutgoingMessageOwnership } from './outgoingMessageOwnership'

export type OutgoingPhase = 'queued' | 'uploading' | 'processing' | 'sending' | 'awaiting_ack' | 'offline' | 'failed'
export type OutgoingAttachmentPhase = 'queued' | 'uploading' | 'processing' | 'uploaded' | 'failed'

export interface OutgoingAttachment {
  localId: string
  file: File
  uploadId?: string
  uploaded?: UploadedChatFile
  progress: number
  phase: OutgoingAttachmentPhase
}

export interface OutgoingMessage {
  clientNonce: string
  userId: number
  conversation: { type: 'channel' | 'dm'; id: number }
  content: string
  replyToId?: number
  createdAt: string
  phase: OutgoingPhase
  attachments: OutgoingAttachment[]
  error?: { code: string; message: string; retryable: boolean }
  sendAttempt: number
}

interface OutgoingState {
  messages: OutgoingMessage[]
  initializedUserId: number | null
  persistenceWarning: string | null
  initialize: (userId: number, token: string) => Promise<void>
  enqueue: (input: { userId: number; conversation: OutgoingMessage['conversation']; content: string; files?: File[]; replyToId?: number }) => string
  retry: (clientNonce: string) => void
  cancel: (clientNonce: string) => Promise<void>
  acknowledge: (clientNonce?: string | null) => void
  reject: (payload: any) => void
  clearForLogout: () => Promise<void>
}

const controllers = new Map<string, AbortController>()
const progressUpdates = new Map<string, number>()
const activeConversations = new Set<string>()
const ackTimers = new Map<string, number>()
const uploadWaiters: Array<() => void> = []
const dirtyRecords = new Set<string>()
let uploadSlots = 0
let subscribed = false
let broadcast: BroadcastChannel | null = null
let leaderRelease: (() => void) | null = null
let leadershipAbort: AbortController | null = null
let leadershipGeneration = 0
let persistTimer: number | null = null
const ownership = new OutgoingMessageOwnership()

const conversationKey = (message: OutgoingMessage) => `${message.conversation.type}:${message.conversation.id}`

async function withUploadSlot<T>(task: () => Promise<T>): Promise<T> {
  if (uploadSlots >= 3) await new Promise<void>((resolve) => uploadWaiters.push(resolve))
  uploadSlots += 1
  try {
    return await task()
  } finally {
    uploadSlots -= 1
    uploadWaiters.shift()?.()
  }
}

function persistSoon(clientNonce: string) {
  dirtyRecords.add(clientNonce)
  if (persistTimer !== null) return
  persistTimer = window.setTimeout(async () => {
    persistTimer = null
    const nonces = Array.from(dirtyRecords)
    dirtyRecords.clear()
    for (const nonce of nonces) {
      const record = useOutgoingMessageStore.getState().messages.find((item) => item.clientNonce === nonce)
      if (!record) continue
      try {
        await saveOutgoingRecord(record as unknown as PersistedOutgoingRecord)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          useOutgoingMessageStore.setState({ persistenceWarning: 'Недостаточно места: отправка продолжится, но не переживет обновление страницы.' })
        }
      }
    }
    broadcast?.postMessage({ type: 'changed' })
  }, 100)
}

function updateMessage(clientNonce: string, updater: (message: OutgoingMessage) => OutgoingMessage) {
  useOutgoingMessageStore.setState((state) => ({
    messages: state.messages.map((message) => message.clientNonce === clientNonce ? updater(message) : message),
  }))
  persistSoon(clientNonce)
}

function sendPayload(message: OutgoingMessage): boolean {
  const base = {
    client_nonce: message.clientNonce,
    content: message.content,
    attachment_upload_ids: message.attachments.map((item) => item.uploadId).filter(Boolean),
    reply_to_id: message.replyToId,
  }
  return unifiedWebSocketService.send(message.conversation.type === 'channel'
    ? { type: 'chat_message', text_channel_id: message.conversation.id, ...base }
    : { type: 'dm_message', recipient_id: message.conversation.id, ...base })
}

function scheduleAckRetry(clientNonce: string, attempt = 0) {
  const delays = [2000, 5000, 10000]
  const oldTimer = ackTimers.get(clientNonce)
  if (oldTimer) window.clearTimeout(oldTimer)
  const timer = window.setTimeout(() => {
    const message = useOutgoingMessageStore.getState().messages.find((item) => item.clientNonce === clientNonce)
    if (!message || message.phase !== 'awaiting_ack') return
    if (attempt >= delays.length) {
      updateMessage(clientNonce, (item) => ({ ...item, phase: 'failed', error: { code: 'ack_timeout', message: 'Сервер не подтвердил отправку', retryable: true } }))
      scheduleQueue()
      return
    }
    if (!unifiedWebSocketService.isConnected() || !sendPayload(message)) {
      updateMessage(clientNonce, (item) => ({ ...item, phase: 'offline' }))
      return
    }
    updateMessage(clientNonce, (item) => ({ ...item, sendAttempt: item.sendAttempt + 1 }))
    scheduleAckRetry(clientNonce, attempt + 1)
  }, delays[Math.min(attempt, delays.length - 1)])
  ackTimers.set(clientNonce, timer)
}

async function uploadAttachment(message: OutgoingMessage, attachment: OutgoingAttachment) {
  const controller = new AbortController()
  const controllerKey = `${message.clientNonce}:${attachment.localId}`
  controllers.set(controllerKey, controller)
  updateMessage(message.clientNonce, (item) => ({
    ...item,
    phase: 'uploading',
    attachments: item.attachments.map((candidate) => candidate.localId === attachment.localId ? { ...candidate, phase: 'uploading', progress: 0 } : candidate),
  }))
  try {
    const uploaded = await withUploadSlot(() => uploadService.uploadFile(attachment.file, {
      signal: controller.signal,
      onProgress: (loaded, total) => {
        const progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0
        const now = performance.now()
        const lastUpdate = progressUpdates.get(controllerKey) || 0
        if (progress < 100 && now - lastUpdate < 100) return
        progressUpdates.set(controllerKey, now)
        updateMessage(message.clientNonce, (item) => ({
          ...item,
          phase: progress >= 100 ? 'processing' : 'uploading',
          attachments: item.attachments.map((candidate) => candidate.localId === attachment.localId
            ? { ...candidate, progress, phase: progress >= 100 ? 'processing' : 'uploading' }
            : candidate),
        }))
      },
    }))
    updateMessage(message.clientNonce, (item) => ({
      ...item,
      attachments: item.attachments.map((candidate) => candidate.localId === attachment.localId
        ? { ...candidate, uploadId: uploaded.upload_id, uploaded, progress: 100, phase: 'uploaded' }
        : candidate),
    }))
  } finally {
    controllers.delete(controllerKey)
    progressUpdates.delete(controllerKey)
  }
}

async function processMessage(initial: OutgoingMessage) {
  const key = conversationKey(initial)
  if (activeConversations.has(key) || !ownership.canProcess(initial.clientNonce)) return
  activeConversations.add(key)
  try {
    if (!navigator.onLine || !unifiedWebSocketService.isConnected()) {
      updateMessage(initial.clientNonce, (item) => ({ ...item, phase: 'offline' }))
      return
    }
    let message = useOutgoingMessageStore.getState().messages.find((item) => item.clientNonce === initial.clientNonce)
    if (!message) return
    const pendingAttachments = message.attachments.filter((item) => !item.uploadId)
    if (pendingAttachments.length > 0) await Promise.all(pendingAttachments.map((attachment) => uploadAttachment(message!, attachment)))
    message = useOutgoingMessageStore.getState().messages.find((item) => item.clientNonce === initial.clientNonce)
    if (!message) return
    updateMessage(message.clientNonce, (item) => ({ ...item, phase: 'sending', error: undefined }))
    if (!sendPayload(message)) {
      updateMessage(message.clientNonce, (item) => ({ ...item, phase: 'offline' }))
      return
    }
    updateMessage(message.clientNonce, (item) => ({ ...item, phase: 'awaiting_ack' }))
    scheduleAckRetry(message.clientNonce)
  } catch (error) {
    if (axios.isCancel(error)) return
    const status = axios.isAxiosError(error) ? error.response?.status : undefined
    const retryable = !status || status === 429 || status >= 500
    const detail = axios.isAxiosError(error) ? error.response?.data?.detail || error.message : 'Не удалось отправить сообщение'
    if (retryable && initial.sendAttempt < 3) {
      const responseRetry = axios.isAxiosError(error) ? Number(error.response?.data?.retry_after || 0) * 1000 : 0
      const delay = responseRetry || [2000, 5000, 10000][initial.sendAttempt]
      updateMessage(initial.clientNonce, (item) => ({
        ...item,
        phase: 'failed',
        sendAttempt: item.sendAttempt + 1,
        error: { code: status === 429 ? 'rate_limited' : 'temporary_error', message: `Повторная попытка через ${Math.ceil(delay / 1000)} сек.`, retryable: true },
      }))
      window.setTimeout(() => {
        updateMessage(initial.clientNonce, (item) => ({ ...item, phase: navigator.onLine ? 'queued' : 'offline', error: undefined }))
        scheduleQueue()
      }, delay)
      return
    }
    updateMessage(initial.clientNonce, (item) => ({
      ...item,
      phase: navigator.onLine ? 'failed' : 'offline',
      error: { code: status ? `http_${status}` : 'network_error', message: String(detail), retryable },
      attachments: item.attachments.map((attachment) => attachment.phase === 'uploaded' ? attachment : { ...attachment, phase: 'failed' }),
    }))
  } finally {
    activeConversations.delete(key)
    scheduleQueue()
  }
}

function scheduleQueue() {
  if (typeof window === 'undefined') return
  const messages = [...useOutgoingMessageStore.getState().messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const seen = new Set<string>()
  for (const message of messages) {
    const key = conversationKey(message)
    if (seen.has(key)) continue
    seen.add(key)
    if (
      ownership.canProcess(message.clientNonce)
      && (message.phase === 'queued' || message.phase === 'offline')
    ) void processMessage(message)
  }
}

function subscribeToSocket() {
  if (subscribed) return
  subscribed = true
  const acknowledge = (payload: any) => useOutgoingMessageStore.getState().acknowledge((payload?.data || payload)?.client_nonce)
  unifiedWebSocketService.on('new_message', acknowledge)
  unifiedWebSocketService.on('dm', acknowledge)
  unifiedWebSocketService.on('message_ack', (payload: unknown) => applyOutgoingMessageAck(
    payload,
    useChatStore.getState().addMessage,
    useOutgoingMessageStore.getState().acknowledge,
  ))
  unifiedWebSocketService.on('message_send_failed', (payload: any) => useOutgoingMessageStore.getState().reject(payload?.data || payload))
  unifiedWebSocketService.onConnectionStatusChange(({ isConnected }) => {
    if (!isConnected) {
      useOutgoingMessageStore.setState((state) => ({ messages: state.messages.map((message) => message.phase === 'queued' || message.phase === 'sending' ? { ...message, phase: 'offline' as OutgoingPhase } : message) }))
      return
    }
    useOutgoingMessageStore.setState((state) => ({ messages: state.messages.map((message) => message.phase === 'offline' ? { ...message, phase: 'queued' as OutgoingPhase } : message) }))
    scheduleQueue()
  })
  window.addEventListener('online', () => {
    useOutgoingMessageStore.setState((state) => ({ messages: state.messages.map((message) => message.phase === 'offline' ? { ...message, phase: 'queued' as OutgoingPhase } : message) }))
    scheduleQueue()
  })
}

function releaseLeadership() {
  leadershipGeneration += 1
  leadershipAbort?.abort()
  leadershipAbort = null
  leaderRelease?.()
  leaderRelease = null
  ownership.setLeader(false)
}

function acquireLeadership(userId: number) {
  releaseLeadership()
  if (navigator.locks) {
    const generation = leadershipGeneration
    const controller = new AbortController()
    leadershipAbort = controller
    void navigator.locks.request(
      `miscord-outgoing-${userId}`,
      { signal: controller.signal },
      async (lock) => {
        if (!lock || generation !== leadershipGeneration) return
        ownership.setLeader(true)
        scheduleQueue()
        await new Promise<void>((resolve) => { leaderRelease = resolve })
        if (generation === leadershipGeneration) ownership.setLeader(false)
      },
    ).catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('[OutgoingQueue] leadership failed', error)
      }
    })
    return
  }
  ownership.setLeader(true)
}

export const useOutgoingMessageStore = create<OutgoingState>((set, get) => ({
  messages: [],
  initializedUserId: null,
  persistenceWarning: null,
  initialize: async (userId, token) => {
    if (get().initializedUserId === userId) {
      if (!unifiedWebSocketService.isConnected()) unifiedWebSocketService.connect(token)
      return
    }
    const previousUserId = get().initializedUserId
    // Mark initialization before IndexedDB awaits so React remounts cannot
    // start a second leader election for the same browser tab.
    set({ initializedUserId: userId })
    if (previousUserId && previousUserId !== userId) {
      const previousMessages = get().messages
      await Promise.allSettled(previousMessages.flatMap((message) => message.attachments.map((attachment) => attachment.uploadId).filter((id): id is string => Boolean(id))).map((id) => uploadService.deleteUpload(id)))
      await clearOutgoingRecords(previousUserId)
    }
    releaseLeadership()
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const persisted = await loadOutgoingRecords(userId)
    const expired = (persisted as unknown as OutgoingMessage[]).filter((item) => new Date(item.createdAt).getTime() < sevenDaysAgo)
    await Promise.all(expired.map((item) => deleteOutgoingRecord(item.clientNonce)))
    const restored = (persisted as unknown as OutgoingMessage[])
      .filter((item) => new Date(item.createdAt).getTime() >= sevenDaysAgo)
      .map((item) => ({
        ...item,
        phase: (item.phase === 'failed' ? 'failed' : 'queued') as OutgoingPhase,
        attachments: item.attachments.map((attachment) => attachment.uploadId
          ? { ...attachment, progress: 100, phase: 'uploaded' as OutgoingAttachmentPhase }
          : { ...attachment, progress: 0, phase: 'queued' as OutgoingAttachmentPhase }),
      }))
    set({ messages: restored })
    unifiedWebSocketService.connect(token)
    subscribeToSocket()
    if (typeof BroadcastChannel !== 'undefined') {
      broadcast?.close()
      broadcast = new BroadcastChannel(`miscord-outgoing-${userId}`)
      broadcast.onmessage = async () => {
        if (!ownership.isLeader()) {
          set({ messages: await loadOutgoingRecords(userId) as unknown as OutgoingMessage[] })
        }
      }
    }
    acquireLeadership(userId)
    scheduleQueue()
  },
  enqueue: ({ userId, conversation, content, files = [], replyToId }) => {
    const clientNonce = crypto.randomUUID()
    const message: OutgoingMessage = {
      clientNonce,
      userId,
      conversation,
      content,
      replyToId,
      createdAt: new Date().toISOString(),
      phase: navigator.onLine ? 'queued' : 'offline',
      attachments: files.map((file) => ({ localId: crypto.randomUUID(), file, progress: 0, phase: 'queued' })),
      sendAttempt: 0,
    }
    ownership.claim(clientNonce)
    set((state) => ({ messages: [...state.messages, message] }))
    // Local delivery must not wait for IndexedDB. A blocked database upgrade
    // or a slow transaction would otherwise leave the message in "queued"
    // forever even though the realtime connection is already available.
    subscribeToSocket()
    scheduleQueue()
    // Other tabs are notified only after persistence settles, so they never
    // observe a broadcast before the record is available to load.
    void saveOutgoingRecord(message as unknown as PersistedOutgoingRecord)
      .catch(() => set({ persistenceWarning: 'Сообщение отправляется, но не сохранится после обновления страницы.' }))
      .finally(() => {
        broadcast?.postMessage({ type: 'changed' })
      })
    return clientNonce
  },
  retry: (clientNonce) => {
    updateMessage(clientNonce, (message) => ({
      ...message,
      phase: navigator.onLine ? 'queued' : 'offline',
      error: undefined,
      attachments: message.attachments.map((attachment) => attachment.uploadId ? attachment : { ...attachment, phase: 'queued', progress: 0 }),
    }))
    scheduleQueue()
  },
  cancel: async (clientNonce) => {
    const message = get().messages.find((item) => item.clientNonce === clientNonce)
    if (!message || message.phase === 'awaiting_ack') return
    message.attachments.forEach((attachment) => controllers.get(`${clientNonce}:${attachment.localId}`)?.abort())
    await Promise.allSettled(message.attachments.map((attachment) => attachment.uploadId).filter((id): id is string => Boolean(id)).map((id) => uploadService.deleteUpload(id)))
    set((state) => ({ messages: state.messages.filter((item) => item.clientNonce !== clientNonce) }))
    ownership.release(clientNonce)
    await deleteOutgoingRecord(clientNonce)
    broadcast?.postMessage({ type: 'changed' })
    scheduleQueue()
  },
  acknowledge: (clientNonce) => {
    if (!clientNonce) return
    const timer = ackTimers.get(clientNonce)
    if (timer) window.clearTimeout(timer)
    ackTimers.delete(clientNonce)
    set((state) => ({ messages: state.messages.filter((item) => item.clientNonce !== clientNonce) }))
    ownership.release(clientNonce)
    dirtyRecords.delete(clientNonce)
    void deleteOutgoingRecord(clientNonce)
      .finally(() => broadcast?.postMessage({ type: 'changed' }))
    scheduleQueue()
  },
  reject: (payload) => {
    const clientNonce = payload?.client_nonce
    if (!clientNonce) return
    if (payload.code === 'upload_expired') {
      updateMessage(clientNonce, (message) => ({
        ...message,
        phase: 'failed',
        error: { code: payload.code, message: payload.message, retryable: true },
        attachments: message.attachments.map((attachment) => ({ ...attachment, uploadId: undefined, uploaded: undefined, progress: 0, phase: 'queued' })),
      }))
      return
    }
    if (payload.retryable && payload.retry_after_seconds) {
      const delay = Math.max(250, Number(payload.retry_after_seconds) * 1000)
      updateMessage(clientNonce, (message) => ({ ...message, phase: 'failed', error: { code: payload.code, message: `${payload.message}. Повтор через ${Math.ceil(delay / 1000)} сек.`, retryable: true } }))
      window.setTimeout(() => {
        updateMessage(clientNonce, (message) => ({ ...message, phase: navigator.onLine ? 'queued' : 'offline', error: undefined }))
        scheduleQueue()
      }, delay)
      return
    }
    updateMessage(clientNonce, (message) => ({ ...message, phase: 'failed', error: { code: payload.code || 'send_failed', message: payload.message || 'Не удалось отправить сообщение', retryable: payload.retryable !== false } }))
    scheduleQueue()
  },
  clearForLogout: async () => {
    const userId = get().initializedUserId
    const messages = get().messages
    controllers.forEach((controller) => controller.abort())
    controllers.clear()
    ackTimers.forEach((timer) => window.clearTimeout(timer))
    ackTimers.clear()
    await Promise.allSettled(messages.flatMap((message) => message.attachments.map((attachment) => attachment.uploadId).filter((id): id is string => Boolean(id))).map((id) => uploadService.deleteUpload(id)))
    if (userId) await clearOutgoingRecords(userId)
    releaseLeadership()
    ownership.clear()
    broadcast?.close()
    broadcast = null
    set({ messages: [], initializedUserId: null, persistenceWarning: null })
  },
}))
