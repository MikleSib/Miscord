/**
 * Утилиты mesh-голосового канала (Discord-like).
 * Меньший user_id создаёт offer — оба не шлют offer одновременно.
 */
export function shouldCreateOffer(localUserId: number | null, remoteUserId: number): boolean {
  if (localUserId === null || Number.isNaN(localUserId)) return false;
  return localUserId < remoteUserId;
}

export function canAcceptAnswer(signalingState: RTCSignalingState): boolean {
  return signalingState === 'have-local-offer';
}

export function shouldBufferIceCandidate(
  hasPeer: boolean,
  hasRemoteDescription: boolean
): boolean {
  return !hasPeer || !hasRemoteDescription;
}
