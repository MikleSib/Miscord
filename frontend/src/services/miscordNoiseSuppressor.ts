const AUDIO_ASSET_BASE = '/audio';
const WORKLET_PATH = `${AUDIO_ASSET_BASE}/rnnoise-worklet.js`;
const WASM_PATH = `${AUDIO_ASSET_BASE}/rnnoise.wasm`;
const WASM_SIMD_PATH = `${AUDIO_ASSET_BASE}/rnnoise-simd.wasm`;

type DestroyableAudioWorkletNode = AudioWorkletNode & { destroy: () => void };

export class NoiseSuppressorInitializationCancelledError extends Error {
  constructor() {
    super('Noise suppressor initialization was superseded');
    this.name = 'NoiseSuppressorInitializationCancelledError';
  }
}

export class MiscordNoiseSuppressor {
  private wasmBinaryPromise: Promise<ArrayBuffer> | null = null;
  private node: DestroyableAudioWorkletNode | null = null;
  private generation = 0;
  private readonly disposedNodes = new WeakSet<AudioWorkletNode>();

  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof WebAssembly !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      'audioWorklet' in AudioContext.prototype
    );
  }

  private loadWasmBinary(): Promise<ArrayBuffer> {
    if (!this.wasmBinaryPromise) {
      // The package defines an AudioWorkletNode subclass at module scope, so it
      // must only be evaluated in the browser after feature detection.
      this.wasmBinaryPromise = import('@sapphi-red/web-noise-suppressor')
        .then(({ loadRnnoise }) =>
          loadRnnoise({
            url: WASM_PATH,
            simdUrl: WASM_SIMD_PATH,
          })
        )
        .then((binary) => {
          const signature = new Uint8Array(binary, 0, Math.min(binary.byteLength, 4));
          const isWasm =
            signature.length === 4 &&
            signature[0] === 0x00 &&
            signature[1] === 0x61 &&
            signature[2] === 0x73 &&
            signature[3] === 0x6d;

          if (!isWasm) {
            this.wasmBinaryPromise = null;
            throw new Error('RNNoise WASM asset is missing or invalid');
          }

          return binary;
        });
    }

    return this.wasmBinaryPromise;
  }

  /** Заранее тянет модуль и WASM, чтобы вход в голосовой канал не ждал загрузку. */
  async preload(): Promise<void> {
    if (!MiscordNoiseSuppressor.isSupported()) return;
    await this.loadWasmBinary();
  }

  async createNode(audioContext: AudioContext): Promise<DestroyableAudioWorkletNode> {
    if (!MiscordNoiseSuppressor.isSupported()) {
      throw new Error('AudioWorklet or WebAssembly is not supported');
    }

    if (audioContext.sampleRate !== 48000) {
      throw new Error(`Miscord AI requires 48 kHz audio (got ${audioContext.sampleRate} Hz)`);
    }

    const generation = ++this.generation;
    this.destroyCurrentNode();

    let module: typeof import('@sapphi-red/web-noise-suppressor');
    let wasmBinary: ArrayBuffer;
    try {
      [module, wasmBinary] = await Promise.all([
        import('@sapphi-red/web-noise-suppressor'),
        this.loadWasmBinary(),
        audioContext.audioWorklet.addModule(WORKLET_PATH),
      ]);
    } catch (error) {
      if (generation !== this.generation) {
        throw new NoiseSuppressorInitializationCancelledError();
      }
      throw error;
    }
    if (generation !== this.generation) {
      throw new NoiseSuppressorInitializationCancelledError();
    }

    const node = new module.RnnoiseWorkletNode(audioContext, {
      maxChannels: 1,
      wasmBinary,
    }) as DestroyableAudioWorkletNode;
    if (generation !== this.generation) {
      this.disposeNode(node);
      throw new NoiseSuppressorInitializationCancelledError();
    }
    this.node = node;

    return node;
  }

  async warmUp(durationMs = 180): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));
  }

  destroy(): void {
    this.generation += 1;
    this.destroyCurrentNode();
  }

  destroyNode(node: AudioWorkletNode): void {
    if (this.node === node) {
      this.node = null;
      this.generation += 1;
    }
    this.disposeNode(node as DestroyableAudioWorkletNode);
  }

  private destroyCurrentNode(): void {
    const node = this.node;
    this.node = null;
    if (node) this.disposeNode(node);
  }

  private disposeNode(node: DestroyableAudioWorkletNode): void {
    if (this.disposedNodes.has(node)) return;
    this.disposedNodes.add(node);
    try {
      node.destroy();
      node.disconnect();
    } catch (error) {
      console.warn('[Miscord AI] Failed to destroy RNNoise node:', error);
    }
  }
}

export const miscordNoiseSuppressor = new MiscordNoiseSuppressor();
