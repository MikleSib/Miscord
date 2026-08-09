import client from 'prom-client';

client.collectDefaultMetrics({ prefix: 'miscord_voice_' });

export const metrics = {
  registry: client.register,
  rooms: new client.Gauge({ name: 'miscord_voice_rooms', help: 'Active SFU rooms' }),
  peers: new client.Gauge({ name: 'miscord_voice_peers', help: 'Active media peers' }),
  transports: new client.Gauge({ name: 'miscord_voice_transports', help: 'Active media transports' }),
  producers: new client.Gauge({ name: 'miscord_voice_producers', help: 'Active media producers' }),
  consumers: new client.Gauge({ name: 'miscord_voice_consumers', help: 'Active media consumers' }),
  botSessions: new client.Gauge({ name: 'miscord_voice_bot_sessions', help: 'Active UDP bot sessions' }),
  botUdpPacketsAccepted: new client.Counter({
    name: 'miscord_voice_bot_udp_packets_accepted_total',
    help: 'Authenticated bot RTP packets accepted by the SFU',
  }),
  botUdpPacketsDropped: new client.Counter({
    name: 'miscord_voice_bot_udp_packets_dropped_total',
    help: 'Bot UDP packets rejected after discovery',
  }),
  mediaSocketCloses: new client.Counter({
    name: 'miscord_voice_media_socket_closes_total',
    help: 'Media WebSocket closes by status code',
    labelNames: ['code'],
  }),
  transportStateTransitions: new client.Counter({
    name: 'miscord_voice_transport_state_transitions_total',
    help: 'WebRTC transport state transitions',
    labelNames: ['kind', 'state'],
  }),
  authFailures: new client.Counter({ name: 'miscord_voice_auth_failures_total', help: 'Rejected media tickets' }),
  workerDeaths: new client.Counter({ name: 'miscord_voice_worker_deaths_total', help: 'Unexpected mediasoup worker deaths' }),
  rpcDuration: new client.Histogram({
    name: 'miscord_voice_rpc_duration_seconds',
    help: 'Media RPC latency',
    labelNames: ['type'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  }),
};
