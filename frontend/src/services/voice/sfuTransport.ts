import { Device } from 'mediasoup-client';
import type { Consumer, Producer, Transport } from 'mediasoup-client/types';

import { MediaRpcClient } from './mediaRpcClient';
import type { MediaSource, ProducerDescriptor, RemoteMedia } from './types';

type RemoteMediaHandler = (media: RemoteMedia) => void;
type SpeakersHandler = (userIds: number[]) => void;

export class SfuTransport {
  private readonly rpc = new MediaRpcClient();
  private readonly device = new Device();
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private microphone: Producer | null = null;
  private screenVideo: Producer | null = null;
  private screenAudio: Producer | null = null;
  private readonly consumers = new Map<string, Consumer>();
  private readonly producerDirectory = new Map<string, ProducerDescriptor>();
  private readonly requestedScreenUsers = new Set<number>();
  private remoteMediaHandler?: RemoteMediaHandler;
  private speakersHandler?: SpeakersHandler;
  private failureHandler?: (message: string) => void;

  async connect(url: string, ticket: string, microphoneTrack: MediaStreamTrack): Promise<void> {
    const identified = await this.rpc.connect(url, ticket);
    await this.device.load({ routerRtpCapabilities: identified.router_rtp_capabilities });
    this.bindNotifications();
    this.sendTransport = await this.createTransport('send');
    this.recvTransport = await this.createTransport('recv');
    this.microphone = await this.sendTransport.produce({
      track: microphoneTrack,
      codecOptions: { opusStereo: true, opusDtx: true, opusFec: true },
      appData: { source: 'microphone' },
    });
    for (const descriptor of identified.producers as ProducerDescriptor[]) {
      this.producerDirectory.set(descriptor.producer_id, descriptor);
      if (descriptor.source === 'microphone') await this.consume(descriptor);
    }
  }

  onRemoteMedia(handler: RemoteMediaHandler): void {
    this.remoteMediaHandler = handler;
  }

  onActiveSpeakers(handler: SpeakersHandler): void {
    this.speakersHandler = handler;
  }

  onFailure(handler: (message: string) => void): void {
    this.failureHandler = handler;
  }

  async setMicrophoneMuted(muted: boolean): Promise<void> {
    if (!this.microphone) return;
    if (muted) {
      this.microphone.pause();
      await this.rpc.request('pause_producer', { producer_id: this.microphone.id });
    } else {
      this.microphone.resume();
      await this.rpc.request('resume_producer', { producer_id: this.microphone.id });
    }
  }

  async setDeafened(deafened: boolean): Promise<void> {
    await Promise.all([...this.consumers.values()].filter((item) => item.kind === 'audio').map(async (consumer) => {
      if (deafened) {
        consumer.pause();
        await this.rpc.request('pause_consumer', { consumer_id: consumer.id });
      } else {
        consumer.resume();
        await this.rpc.request('resume_consumer', { consumer_id: consumer.id });
      }
    }));
  }

  async replaceMicrophoneTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.microphone) throw new Error('Microphone producer is unavailable');
    await this.microphone.replaceTrack({ track });
  }

  async startScreenShare(stream: MediaStream): Promise<void> {
    if (!this.sendTransport) throw new Error('Voice transport is not connected');
    await this.stopScreenShare();
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Screen video track is missing');
    this.screenVideo = await this.sendTransport.produce({
      track: videoTrack,
      encodings: [
        { maxBitrate: 300_000, scaleResolutionDownBy: 4 },
        { maxBitrate: 1_200_000, scaleResolutionDownBy: 2 },
        { maxBitrate: 4_000_000, scaleResolutionDownBy: 1 },
      ],
      codecOptions: { videoGoogleStartBitrate: 1_000 },
      appData: { source: 'screen-video' },
    });
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      this.screenAudio = await this.sendTransport.produce({
        track: audioTrack,
        codecOptions: { opusStereo: true, opusFec: true },
        appData: { source: 'screen-audio' },
      });
    }
    videoTrack.addEventListener('ended', () => void this.stopScreenShare(), { once: true });
  }

  async stopScreenShare(): Promise<void> {
    for (const producer of [this.screenVideo, this.screenAudio]) {
      if (!producer) continue;
      await this.rpc.request('close_producer', { producer_id: producer.id }).catch(() => undefined);
      producer.close();
    }
    this.screenVideo = null;
    this.screenAudio = null;
  }

  async ensureScreenShare(userId: number): Promise<void> {
    this.requestedScreenUsers.add(userId);
    const descriptors = [...this.producerDirectory.values()].filter(
      (item) => item.user_id === userId && item.source.startsWith('screen-'),
    );
    for (const descriptor of descriptors) await this.consume(descriptor);
  }

  clearScreenShareRequest(userId: number): void {
    this.requestedScreenUsers.delete(userId);
  }

  async setScreenQuality(userId: number, spatialLayer: number, temporalLayer = 2): Promise<void> {
    const descriptorIds = new Set([...this.producerDirectory.values()]
      .filter((item) => item.user_id === userId && item.source === 'screen-video')
      .map((item) => item.producer_id));
    const consumer = [...this.consumers.values()].find((item) => descriptorIds.has(item.producerId));
    if (consumer) {
      await this.rpc.request('set_consumer_layers', {
        consumer_id: consumer.id,
        spatial_layer: spatialLayer,
        temporal_layer: temporalLayer,
      });
    }
  }

  getRemoteStream(userId: number): MediaStream | undefined {
    const tracks = [...this.consumers.values()]
      .filter((consumer) => {
        const descriptor = this.producerDirectory.get(consumer.producerId);
        return descriptor?.user_id === userId;
      })
      .map((consumer) => consumer.track);
    return tracks.length ? new MediaStream(tracks) : undefined;
  }

  close(): void {
    for (const consumer of this.consumers.values()) consumer.close();
    this.consumers.clear();
    this.microphone?.close();
    this.screenVideo?.close();
    this.screenAudio?.close();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.rpc.close();
    this.producerDirectory.clear();
    this.requestedScreenUsers.clear();
  }

  private async createTransport(direction: 'send' | 'recv'): Promise<Transport> {
    const params = await this.rpc.request('create_transport', {
      direction,
      rtp_capabilities: this.device.rtpCapabilities,
    });
    const options = {
      id: params.transport_id,
      iceParameters: params.ice_parameters,
      iceCandidates: params.ice_candidates,
      dtlsParameters: params.dtls_parameters,
      sctpParameters: params.sctp_parameters,
    };
    const transport = direction === 'send'
      ? this.device.createSendTransport(options)
      : this.device.createRecvTransport(options);
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.rpc.request('connect_transport', {
        transport_id: transport.id,
        dtls_parameters: dtlsParameters,
      }).then(() => callback()).catch(errback);
    });
    if (direction === 'send') {
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        this.rpc.request('produce', {
          transport_id: transport.id,
          kind,
          rtp_parameters: rtpParameters,
          source: appData.source,
        }).then((result) => callback({ id: result.producer_id })).catch(errback);
      });
    }
    transport.on('connectionstatechange', (state) => {
      if (state === 'failed' || state === 'closed') this.failureHandler?.(`Media transport ${state}`);
    });
    return transport;
  }

  private bindNotifications(): void {
    this.rpc.on('producer_available', (descriptor: ProducerDescriptor) => {
      this.producerDirectory.set(descriptor.producer_id, descriptor);
      if (
        descriptor.source === 'microphone'
        || (descriptor.source.startsWith('screen-') && this.requestedScreenUsers.has(descriptor.user_id))
      ) void this.consume(descriptor);
    });
    this.rpc.on('producer_closed', ({ producer_id }: { producer_id: string }) => {
      this.producerDirectory.delete(producer_id);
      for (const [consumerId, consumer] of this.consumers) {
        if (consumer.producerId === producer_id) {
          consumer.close();
          this.consumers.delete(consumerId);
        }
      }
    });
    this.rpc.on('active_speakers', ({ user_ids }: { user_ids: number[] }) => this.speakersHandler?.(user_ids));
    this.rpc.on('connection_failed', ({ message }: { message: string }) => this.failureHandler?.(message));
  }

  private async consume(descriptor: ProducerDescriptor): Promise<void> {
    if (!this.recvTransport || [...this.consumers.values()].some((item) => item.producerId === descriptor.producer_id)) return;
    const result = await this.rpc.request('consume', {
      transport_id: this.recvTransport.id,
      producer_id: descriptor.producer_id,
      rtp_capabilities: this.device.rtpCapabilities,
    });
    const consumer = await this.recvTransport.consume({
      id: result.consumer_id,
      producerId: result.producer_id,
      kind: result.kind,
      rtpParameters: result.rtp_parameters,
      appData: { source: result.source, userId: result.user_id },
    });
    this.consumers.set(consumer.id, consumer);
    const stream = new MediaStream([consumer.track]);
    this.remoteMediaHandler?.({ userId: result.user_id, source: result.source, stream });
    await this.rpc.request('resume_consumer', { consumer_id: consumer.id });
    consumer.resume();
  }
}
