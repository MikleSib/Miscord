const WORKLET_PATH = '/audio/deepfilternet3/dfn3-worklet.js';
const PROCESSOR_NAME = 'miscord-deepfilternet3';
const WASM_PATH = '/audio/deepfilternet3/dfn3.wasm';
const WEIGHTS_PATH = '/audio/deepfilternet3/dfn3_weights.bin';

type DeepFilterNet3Node = AudioWorkletNode & { destroy: () => void };

export class DeepFilterNet3NoiseSuppressor {
  private node: DeepFilterNet3Node | null = null;
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private ready = false;
  private generation = 0;
  private overloadStrikes = 0;

  static isSupported(): boolean {
    if (typeof window === 'undefined' || typeof WebAssembly === 'undefined' || typeof AudioWorkletNode === 'undefined' || typeof AudioContext === 'undefined' || !('audioWorklet' in AudioContext.prototype)) return false;
    try {
      const simdProbe = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
      return WebAssembly.validate(simdProbe);
    } catch {
      return false;
    }
  }

  private async loadAsset(path: string): Promise<ArrayBuffer> {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Не удалось загрузить ${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  async createNode(audioContext: AudioContext): Promise<DeepFilterNet3Node> {
    if (!DeepFilterNet3NoiseSuppressor.isSupported()) throw new Error('AudioWorklet, WebAssembly или SIMD не поддерживается');
    if (audioContext.sampleRate !== 48000) throw new Error(`DeepFilterNet3 требует 48 кГц на входе (получено ${audioContext.sampleRate} Гц)`);
    this.destroy();
    const generation = ++this.generation;
    this.ready = false;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const [wasmBinary, weightsBinary] = await Promise.all([
      this.loadAsset(WASM_PATH),
      this.loadAsset(WEIGHTS_PATH),
      audioContext.audioWorklet.addModule(WORKLET_PATH),
    ]);
    if (generation !== this.generation) throw new Error('Инициализация DeepFilterNet3 отменена');
    const magic = new Uint8Array(wasmBinary, 0, Math.min(4, wasmBinary.byteLength));
    if (magic.length !== 4 || magic[0] !== 0 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
      throw new Error('Файл DeepFilterNet3 WASM повреждён');
    }
    const node = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { wasmBinary, weightsBinary },
    }) as DeepFilterNet3Node;
    this.node = node;
    node.port.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (generation !== this.generation) return;
      if (message?.type === 'ready') { this.ready = true; this.overloadStrikes = 0; this.resolveReady?.(); this.resolveReady = null; this.rejectReady = null; }
      if (message?.type === 'error') this.fail(new Error(message.message || 'Ошибка DeepFilterNet3'));
      if (message?.type === 'perf') {
        this.overloadStrikes = message.rtf > 1 ? this.overloadStrikes + 1 : 0;
        if (this.overloadStrikes >= 3) this.fail(new Error('DeepFilterNet3 устойчиво не успевает обрабатывать звук в реальном времени'));
      }
    };
    node.destroy = () => this.destroy();
    return node;
  }

  private fail(error: Error): void {
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.node?.port.postMessage({ type: 'worker-error' });
    if (this.node) this.node.dispatchEvent(new Event('processorerror'));
  }

  async warmUp(timeoutMs = 20000): Promise<void> {
    if (this.ready) return;
    if (!this.readyPromise) throw new Error('DeepFilterNet3 не инициализирован');
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        this.readyPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Загрузка DeepFilterNet3 заняла слишком много времени')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  destroy(): void {
    const node = this.node;
    this.node = null;
    try {
      node?.port.postMessage({ type: 'destroy' });
      node?.disconnect();
    } catch {}
    if (!this.ready) this.rejectReady?.(new Error('DeepFilterNet3 остановлен'));
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;
    this.ready = false;
  }
}

export const deepFilterNet3NoiseSuppressor = new DeepFilterNet3NoiseSuppressor();
