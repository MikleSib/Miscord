import type { RtpCapabilities, RtpParameters, DtlsParameters, MediaKind } from 'mediasoup/types';

export type MediaSource = 'microphone' | 'screen-video' | 'screen-audio' | 'soundboard';

export interface MediaClaims {
  sub: string;
  jti: string;
  channel_id: number;
  session_id: string;
  room_epoch: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  is_bot?: boolean;
  self_mute?: boolean;
  self_deaf?: boolean;
  server_mute?: boolean;
  server_deaf?: boolean;
  can_speak?: boolean;
  can_stream?: boolean;
  stage_role?: 'audience' | 'speaker' | 'moderator';
  application_id?: number;
  guild_id?: number;
  protocol_version: number;
}

export interface RpcRequest {
  type: string;
  request_id?: string;
  ticket?: string;
  direction?: 'send' | 'recv';
  transport_id?: string;
  producer_id?: string;
  consumer_id?: string;
  kind?: MediaKind;
  source?: MediaSource;
  dtls_parameters?: DtlsParameters;
  rtp_parameters?: RtpParameters;
  rtp_capabilities?: RtpCapabilities;
  spatial_layer?: number;
  temporal_layer?: number;
  speaking?: boolean;
  playback_ticket?: string;
  e2ee?: {
    protocol_version: number;
    credential_id: string;
    key_package: string;
  };
  target_session_id?: string;
  credential_id?: string;
  epoch?: string;
  commit?: string;
  welcome?: string;
  ratchet_tree?: string;
  bot_envelopes?: unknown[];
}

export interface SoundboardClaims {
  sub: string;
  jti: string;
  channel_id: number;
  session_id: string;
  purpose: 'soundboard';
  sound_id: number;
  duration_ms: number;
  protocol_version: number;
}

export interface ProducerDescriptor {
  producer_id: string;
  user_id: number;
  source: MediaSource;
  kind: MediaKind;
  e2ee_sender: string;
}
