const AUDIO_ASSET_BASE = '/audio';
const WORKLET_PATH = `${AUDIO_ASSET_BASE}/rnnoise-worklet.js`;
const WASM_PATH = `${AUDIO_ASSET_BASE}/rnnoise.wasm`;
const WASM_SIMD_PATH = `${AUDIO_ASSET_BASE}/rnnoise-simd.wasm`;

type DestroyableAudioWorkletNode = AudioWorkletNode & { destroy: () => void };

export class MiscordNoiseSuppressor {
  private wasmBinaryPromise: Promise<ArrayBuffer> | null = null;
  private node: DestroyableAudioWorkletNode | null = null;

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

  async createNode(audioContext: AudioContext): Promise<DestroyableAudioWorkletNode> {
    if (!MiscordNoiseSuppressor.isSupported()) {
      throw new Error('AudioWorklet or WebAssembly is not supported');
    }

    if (audioContext.sampleRate !== 48000) {
      throw new Error(`Miscord AI requires 48 kHz audio (got ${audioContext.sampleRate} Hz)`);
    }

    this.destroy();

    const [module, wasmBinary] = await Promise.all([
      import('@sapphi-red/web-noise-suppressor'),
      this.loadWasmBinary(),
      audioContext.audioWorklet.addModule(WORKLET_PATH),
    ]);

    this.node = new module.RnnoiseWorkletNode(audioContext, {
      maxChannels: 1,
      wasmBinary,
    });

    return this.node;
  }

  async warmUp(durationMs = 180): Promise<void> {
    await new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));
  }

  destroy(): void {
    if (!this.node) return;

    try {
      this.node.destroy();
      this.node.disconnect();
    } catch (error) {
      console.warn('[Miscord AI] Failed to destroy RNNoise node:', error);
    } finally {
      this.node = null;
    }
  }
}

export const miscordNoiseSuppressor = new MiscordNoiseSuppressor();
