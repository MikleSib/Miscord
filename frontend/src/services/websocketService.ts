import unifiedWebSocketService, { type ConnectionStatus } from './unifiedWebSocketService'

type Handler = (data: any) => void

/** Legacy facade backed by the single /ws/unified connection. */
class WebSocketServiceFacade {
  connect(token: string) { unifiedWebSocketService.connect(token) }
  disconnect() { unifiedWebSocketService.disconnect() }
  fullDisconnect() { unifiedWebSocketService.fullDisconnect() }
  isConnected() { return unifiedWebSocketService.isConnected() }
  send(data: unknown) { return unifiedWebSocketService.send(data) }
  on(event: string, handler: Handler) { unifiedWebSocketService.on(event, handler) }
  off(event: string, handler: Handler) { unifiedWebSocketService.off(event, handler) }
  onConnectionStatusChange(handler: (status: ConnectionStatus) => void) {
    unifiedWebSocketService.onConnectionStatusChange(handler)
    return () => unifiedWebSocketService.offConnectionStatusChange(handler)
  }

  onChannelInvitation(handler: Handler) {
    this.on('channel_invitation', handler)
    this.on('server_invite', handler)
  }
  onServerRemoved(handler: Handler) { this.on('server_removed', handler) }
  onTextChannelUpdated(handler: Handler) { this.on('text_channel_updated', handler) }
  onVoiceChannelUpdated(handler: Handler) { this.on('voice_channel_updated', handler) }
  onTextChannelDeleted(handler: Handler) { this.on('text_channel_deleted', handler) }
  onVoiceChannelDeleted(handler: Handler) { this.on('voice_channel_deleted', handler) }
  onUserJoinedChannel(handler: Handler) { this.on('user_joined_channel', handler) }
  onUserLeftChannel(handler: Handler) { this.on('user_left_channel', handler) }
  onServerCreated(handler: Handler) { this.on('server_created', handler) }
  onTextChannelCreated(handler: Handler) { this.on('text_channel_created', handler) }
  onVoiceChannelCreated(handler: Handler) { this.on('voice_channel_created', handler) }
  onVoiceChannelJoin(handler: Handler) { this.on('voice_channel_join', handler) }
  onVoiceChannelLeave(handler: Handler) { this.on('voice_channel_leave', handler) }
  onNewMessage(handler: Handler) { unifiedWebSocketService.onNewMessage(handler) }
  onTyping(handler: Handler) { this.on('typing', handler) }
  onMessageDeleted(handler: Handler) { this.on('message_deleted', handler) }
  onMessageEdited(handler: Handler) { this.on('message_edited', handler) }
  onScreenShareStarted(handler: Handler) { this.on('screen_share_started', handler) }
  onScreenShareStopped(handler: Handler) { this.on('screen_share_stopped', handler) }
  onReactionUpdated(handler: Handler) { this.on('reaction_updated', handler) }
  onServerUpdated(handler: Handler) { this.on('server_updated', handler) }
  onServerDeleted(handler: Handler) { this.on('server_deleted', handler) }
  onUserStatusChanged(handler: Handler) { this.on('user_status_changed', handler) }
  onUserProfileUpdated(handler: Handler) { this.on('user_profile_updated', handler) }
}

export default new WebSocketServiceFacade()
