export type MediaSource = 'microphone' | 'screen-video' | 'screen-audio';

export interface VoiceParticipant {
  user_id: number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  is_muted?: boolean;
  is_deafened?: boolean;
  is_sharing_screen?: boolean;
  is_bot?: boolean;
}

export interface VoiceJoinedPayload {
  type: 'voice_joined';
  protocol_version: 1;
  channel_id: number;
  session_id: string;
  room_epoch: string;
  participants: VoiceParticipant[];
  self: { user_id: number; is_muted: boolean; is_deafened: boolean };
  transport: { mode: 'sfu'; ws_url: string; ticket: string };
}

export interface ProducerDescriptor {
  producer_id: string;
  user_id: number;
  source: MediaSource;
  kind: 'audio' | 'video';
}

export interface RemoteMedia {
  userId: number;
  source: MediaSource;
  stream: MediaStream;
}

export interface VoiceCallbacks {
  participantJoined?: (participant: VoiceParticipant) => void;
  participantLeft?: (userId: number) => void;
  participantsReceived?: (participants: VoiceParticipant[]) => void;
  participantStatusChanged?: (userId: number, status: Partial<VoiceParticipant>) => void;
  speakingChanged?: (userId: number | null, speaking: boolean) => void;
  screenShareChanged?: (userId: number, sharing: boolean) => void;
  remoteStream?: (userId: number, stream: MediaStream) => void;
  remoteMedia?: (media: RemoteMedia) => void;
  connectionFailed?: (message: string) => void;
}
