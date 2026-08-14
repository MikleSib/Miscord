import { Device } from 'mediasoup-client';
import type { Consumer, Producer, Transport } from 'mediasoup-client/types';

import { MediaRpcClient } from './mediaRpcClient';
import type { MediaSource, ProducerDescriptor, RemoteMedia } from './types';
import { VoiceE2EE } from './e2ee/voiceE2EE';
import { useVoiceEncryptionStore } from '../../store/voiceEncryptionStore';

type RemoteMediaHandler = (media: RemoteMedia) => void;
type SpeakersHandler = (userIds: number[]) => void;
type BooleanRpcQueue = {
  desired: boolean;
  tail: Promise<void>;
};

export class SfuTransport {
  private readonly rpc = new MediaRpcClient();
  private readonly device = new Device();
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private microphone: Producer | null = null;
  private pendingMicrophoneTrack: MediaStreamTrack | null = null;
  private microphoneGate: BooleanRpcQueue = { desired: false, tail: Promise.resolve() };
  private microphoneGateInitialized = false;
  private speakingState: boolean | null = null;
  private deafened = false;
  private screenVideo: Producer | null = null;
  private screenAudio: Producer | null = null;
  private readonly consumers = new Map<string, Consumer>();
  private readonly consumingProducerIds = new Set<string>();
  private readonly consumerGates = new Map<string, BooleanRpcQueue>();
  private readonly producerDirectory = new Map<string, ProducerDescriptor>();
  private readonly requestedScreenUsers = new Set<number>();
  private remoteMediaHandler?: RemoteMediaHandler;
  private speakersHandler?: SpeakersHandler;
  private failureHandler?: (message: string) => void;
  private e2ee?: VoiceE2EE;

  async connect(
    url: string,
    ticket: string,
    microphoneTrack?: MediaStreamTrack,
    initiallyMuted = false,
    e2eeContext?: { userId: number; sessionId: string },
  ): Promise<void> {
    if (!this.microphoneGateInitialized) {
      this.microphoneGate.desired = initiallyMuted;
      this.microphoneGateInitialized = true;
    }
    let identified: any;
    if (e2eeContext) {
      const credentialId = `${e2eeContext.userId}:${e2eeContext.sessionId}`;
      this.e2ee = new VoiceE2EE(this.rpc, credentialId);
      this.e2ee.onFailure((message) => {
        useVoiceEncryptionStore.getState().setError(message);
        this.failureHandler?.(message);
      });
      this.e2ee.onEpochActive((code) => useVoiceEncryptionStore.getState().setActive(code));
      identified = await this.rpc.connect(url, ticket, { e2ee: await this.e2ee.hello() });
      await this.e2ee.activate(identified.e2ee);
    } else {
      identified = await this.rpc.connect(url, ticket);
    }
    await this.device.load({ routerRtpCapabilities: identified.router_rtp_capabilities });
    this.bindNotifications();
    if (microphoneTrack) this.sendTransport = await this.createTransport('send');
    this.recvTransport = await this.createTransport('recv');
    if (microphoneTrack) await this.produceMicrophone(microphoneTrack);
    for (const descriptor of identified.producers as ProducerDescriptor[]) {
      this.producerDirectory.set(descriptor.producer_id, descriptor);
      if (descriptor.source === 'microphone' || descriptor.source === 'soundboard') {
        await this.consume(descriptor);
      }
    }
  }

  private async produceMicrophone(microphoneTrack: MediaStreamTrack): Promise<void> {
    if (!this.sendTransport) throw new Error('Send transport is unavailable');
    try {
      microphoneTrack.contentHint = 'speech';
    } catch {
      // Older WebKit builds may expose contentHint as read-only.
    }
    const producerTrack = microphoneTrack.clone();
    producerTrack.enabled = false;
    this.pendingMicrophoneTrack = producerTrack;
    try { producerTrack.contentHint = 'speech'; } catch { /* Read-only in older WebKit. */ }
    try {
      this.microphone = await this.sendTransport.produce({
        track: producerTrack,
        disableTrackOnPause: false,
        zeroRtpOnPause: true,
        encodings: [{ maxBitrate: 80_000 }],
        codecOptions: {
          opusStereo: false,
          opusDtx: false,
          opusFec: true,
          opusMaxAverageBitrate: 80_000,
          opusPtime: 20,
        },
        appData: { source: 'microphone' },
      });
      this.e2ee?.protectSender(this.microphone.rtpSender, 'microphone');
    } catch (error) {
      producerTrack.stop();
      throw error;
    } finally {
      if (this.pendingMicrophoneTrack === producerTrack) this.pendingMicrophoneTrack = null;
    }
    if (this.microphoneGate.desired) {
      const gate = this.setMicrophoneMuted(true);
      producerTrack.enabled = true;
      await gate;
    } else producerTrack.enabled = true;
  }

  async playSoundboard(track: MediaStreamTrack, playbackTicket: string): Promise<() => Promise<void>> {
    if (!this.sendTransport) throw new Error('Soundboard is unavailable in receive-only mode');
    const producer = await this.sendTransport.produce({
      track,
      stopTracks: false,
      encodings: [{ maxBitrate: 96_000 }],
      codecOptions: {
        opusStereo: false,
        opusDtx: false,
        opusFec: true,
        opusMaxAverageBitrate: 96_000,
        opusPtime: 20,
      },
      appData: { source: 'soundboard', playbackTicket },
    });
    this.e2ee?.protectSender(producer.rtpSender, 'soundboard');
    return async () => {
      producer.close();
      await this.rpc.request('close_producer', { producer_id: producer.id }).catch(() => undefined);
    };
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
    const queue = this.microphoneGate;
    this.microphoneGateInitialized = true;
    queue.desired = muted;
    if (this.pendingMicrophoneTrack) this.pendingMicrophoneTrack.enabled = !muted;
    const producer = this.microphone;
    if (!producer) return;
    if (muted) producer.pause();
    const previous = queue.tail;
    const task = previous.catch(() => undefined).then(async () => {
      if (this.microphone !== producer || this.microphoneGate !== queue) return;
      const desired = queue.desired;
      await this.rpc.request(desired ? 'pause_producer' : 'resume_producer', {
        producer_id: producer.id,
      });
      if (
        this.microphone !== producer
        || this.microphoneGate !== queue
        || queue.desired !== desired
      ) return;
      if (desired) producer.pause();
      else producer.resume();
    });
    queue.tail = task;
    await task;
  }

  async setSpeaking(speaking: boolean): Promise<void> {
    if (!this.microphone || this.speakingState === speaking) return;
    this.speakingState = speaking;
    try {
      await this.rpc.request('set_speaking', {
        producer_id: this.microphone.id,
        speaking,
      });
    } catch (error) {
      if (this.speakingState === speaking) this.speakingState = null;
      throw error;
    }
  }

  async setDeafened(deafened: boolean): Promise<void> {
    this.deafened = deafened;
    await Promise.all([...this.consumers.values()]
      .filter((item) => item.kind === 'audio')
      .map((consumer) => this.applyConsumerDeafened(consumer, deafened)));
  }

  async replaceMicrophoneTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.microphone) throw new Error('Microphone producer is unavailable');
    const producerTrack = track.clone();
    try {
      await this.microphone.replaceTrack({ track: producerTrack });
    } catch (error) {
      producerTrack.stop();
      throw error;
    }
  }

  async startScreenShare(stream: MediaStream): Promise<void> {
    if (!this.sendTransport) throw new Error('Voice transport is not connected');
    await this.stopScreenShare();
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Screen video track is missing');
    const protectedTracks: MediaStreamTrack[] = [];
    try {
      const protectedVideoTrack = videoTrack.clone();
      protectedTracks.push(protectedVideoTrack);
      protectedVideoTrack.enabled = false;
      this.screenVideo = await this.sendTransport.produce({
        track: protectedVideoTrack,
        encodings: [
          { maxBitrate: 300_000, scaleResolutionDownBy: 4 },
          { maxBitrate: 1_200_000, scaleResolutionDownBy: 2 },
          { maxBitrate: 4_000_000, scaleResolutionDownBy: 1 },
        ],
        codecOptions: { videoGoogleStartBitrate: 1_000 },
        appData: { source: 'screen-video' },
      });
      this.e2ee?.protectSender(this.screenVideo.rtpSender, 'screen-video');
      protectedVideoTrack.enabled = true;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const protectedAudioTrack = audioTrack.clone();
        protectedTracks.push(protectedAudioTrack);
        protectedAudioTrack.enabled = false;
        this.screenAudio = await this.sendTransport.produce({
          track: protectedAudioTrack,
          encodings: [{ maxBitrate: 160_000 }],
          codecOptions: {
            opusStereo: true,
            opusDtx: false,
            opusFec: true,
            opusMaxAverageBitrate: 160_000,
            opusPtime: 20,
          },
          appData: { source: 'screen-audio' },
        });
        this.e2ee?.protectSender(this.screenAudio.rtpSender, 'screen-audio');
        protectedAudioTrack.enabled = true;
      }
    } catch (error) {
      await this.stopScreenShare();
      for (const track of protectedTracks) track.stop();
      throw error;
    }
    const videoProducer = this.screenVideo;
    videoTrack.addEventListener('ended', () => {
      if (this.screenVideo === videoProducer) void this.stopScreenShare();
    }, { once: true });
  }

  async stopScreenShare(): Promise<void> {
    const producers = [this.screenVideo, this.screenAudio].filter(
      (producer): producer is Producer => producer !== null,
    );
    this.screenVideo = null;
    this.screenAudio = null;
    for (const producer of producers) producer.close();
    await Promise.all(producers.map((producer) => this.rpc.request('close_producer', {
      producer_id: producer.id,
    }).catch(() => undefined)));
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
    this.consumingProducerIds.clear();
    this.consumerGates.clear();
    this.pendingMicrophoneTrack?.stop();
    this.pendingMicrophoneTrack = null;
    this.microphone?.close();
    this.screenVideo?.close();
    this.screenAudio?.close();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.e2ee?.close();
    this.e2ee = undefined;
    useVoiceEncryptionStore.getState().reset();
    this.rpc.close();
    this.microphone = null;
    this.microphoneGate = { desired: false, tail: Promise.resolve() };
    this.microphoneGateInitialized = false;
    this.speakingState = null;
    this.deafened = false;
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
          playback_ticket: appData.playbackTicket,
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
        || descriptor.source === 'soundboard'
        || (descriptor.source.startsWith('screen-') && this.requestedScreenUsers.has(descriptor.user_id))
      ) void this.consume(descriptor);
    });
    this.rpc.on('producer_closed', ({ producer_id }: { producer_id: string }) => {
      this.producerDirectory.delete(producer_id);
      for (const [consumerId, consumer] of this.consumers) {
        if (consumer.producerId === producer_id) {
          consumer.close();
          this.consumers.delete(consumerId);
          this.consumerGates.delete(consumerId);
        }
      }
    });
    this.rpc.on('active_speakers', ({ user_ids }: { user_ids: number[] }) => this.speakersHandler?.(user_ids));
    this.rpc.on('connection_failed', ({ message }: { message: string }) => this.failureHandler?.(message));
  }

  private async consume(descriptor: ProducerDescriptor): Promise<void> {
    const producerId = descriptor.producer_id;
    const transport = this.recvTransport;
    if (
      !transport
      || this.consumingProducerIds.has(producerId)
      || [...this.consumers.values()].some((item) => item.producerId === producerId)
    ) return;
    this.consumingProducerIds.add(producerId);
    try {
      const result = await this.rpc.request('consume', {
        transport_id: transport.id,
        producer_id: producerId,
        rtp_capabilities: this.device.rtpCapabilities,
      });
      if (this.recvTransport !== transport || !this.producerDirectory.has(producerId)) {
        await this.rpc.request('close_consumer', { consumer_id: result.consumer_id }).catch(() => undefined);
        return;
      }
      const consumer = await transport.consume({
        id: result.consumer_id,
        producerId: result.producer_id,
        kind: result.kind,
        rtpParameters: result.rtp_parameters,
        appData: { source: result.source, userId: result.user_id },
      });
      this.e2ee?.protectReceiver(
        consumer.rtpReceiver,
        descriptor.e2ee_sender,
        descriptor.source,
      );
      if (this.recvTransport !== transport || !this.producerDirectory.has(producerId)) {
        consumer.close();
        await this.rpc.request('close_consumer', { consumer_id: consumer.id }).catch(() => undefined);
        return;
      }
      this.consumers.set(consumer.id, consumer);
      this.consumerGates.set(consumer.id, { desired: this.deafened, tail: Promise.resolve() });
      const stream = new MediaStream([consumer.track]);
      this.remoteMediaHandler?.({ userId: result.user_id, source: result.source, stream });
      if (consumer.kind === 'audio') await this.applyConsumerDeafened(consumer, this.deafened);
      else {
        await this.rpc.request('resume_consumer', { consumer_id: consumer.id });
        consumer.resume();
      }
    } finally {
      this.consumingProducerIds.delete(producerId);
    }
  }

  private async applyConsumerDeafened(
    consumer: Consumer,
    deafened: boolean,
  ): Promise<void> {
    const queue = this.consumerGates.get(consumer.id);
    if (!queue) return;
    queue.desired = deafened;
    if (deafened) consumer.pause();
    const previous = queue.tail;
    const task = previous.catch(() => undefined).then(async () => {
      if (this.consumers.get(consumer.id) !== consumer || this.consumerGates.get(consumer.id) !== queue) return;
      const desired = queue.desired;
      await this.rpc.request(desired ? 'pause_consumer' : 'resume_consumer', {
        consumer_id: consumer.id,
      });
      if (
        this.consumers.get(consumer.id) !== consumer
        || this.consumerGates.get(consumer.id) !== queue
        || queue.desired !== desired
      ) return;
      if (desired) consumer.pause();
      else consumer.resume();
    });
    queue.tail = task;
    await task;
  }
}
