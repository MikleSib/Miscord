export const UNIFIED_WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru'

export type UnifiedWebSocketHandler = (data: any) => void

export interface ConnectionStatus {
  isConnected: boolean
  isReconnecting: boolean
  reconnectAttempts: number
  maxReconnectAttempts: number
  lastError?: string
}
