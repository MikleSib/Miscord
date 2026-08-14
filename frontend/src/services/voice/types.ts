export type MediaSource = 'microphone' | 'screen-video' | 'screen-audio' | 'soundboard';

export interface VoiceParticipant {
  user_id: number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  is_muted?: boolean;
  is_deafened?: boolean;
  server_muted?: boolean;
  server_deafened?: boolean;
  is_sharing_screen?: boolean;
  is_bot?: boolean;
  stage_role?: 'audience' | 'speaker' | 'moderator';
  stage_suppressed?: boolean;
  requested_to_speak_at?: string | null;
}

export interface VoiceJoinedPayload {
  type: 'voice_joined';
  protocol_version: 1;
  channel_id: number;
  session_id: string;
  room_epoch: string;
  participants: VoiceParticipant[];
  self: {
    user_id: number;
    is_muted: boolean;
    is_deafened: boolean;
    stage_role?: 'audience' | 'speaker' | 'moderator';
    stage_suppressed?: boolean;
  };
  transport: { mode: 'sfu'; ws_url: string; ticket: string };
}

export interface ProducerDescriptor {
  producer_id: string;
  user_id: number;
  source: MediaSource;
  kind: 'audio' | 'video';
  e2ee_sender: string;
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
  /** Сигналинг подтвердил вход: участники известны, медиа ещё договаривается. */
  signalingJoined?: (participants: VoiceParticipant[]) => void;
  participantStatusChanged?: (userId: number, status: Partial<VoiceParticipant>) => void;
  speakingChanged?: (userId: number | null, speaking: boolean) => void;
  screenShareChanged?: (userId: number, sharing: boolean) => void;
  remoteStream?: (userId: number, stream: MediaStream) => void;
  remoteMedia?: (media: RemoteMedia) => void;
  connectionFailed?: (message: string) => void;
}
