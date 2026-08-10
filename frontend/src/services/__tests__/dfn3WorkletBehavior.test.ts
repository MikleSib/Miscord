import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const FRAME_SIZE = 480;
const PRIME_SAMPLES = FRAME_SIZE * 2;

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }
}

class FakeAudioWorkletProcessor {
  readonly port = new FakePort();
}

interface WorkletProcessor {
  port: FakePort;
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
}

function createPassthroughModule() {
  const memory = new ArrayBuffer(256 * 1024);
  const heap = new Float32Array(memory);
  const inputOffset = 4096;
  const outputOffset = 8192;
  return {
    HEAPU8: new Uint8Array(memory),
    HEAPF32: heap,
    _malloc: () => 64,
    _free: () => undefined,
    _dfn3_wasm_create: () => 0,
    _dfn3_wasm_destroy: vi.fn(),
    _dfn3_wasm_get_input_ptr: () => inputOffset * Float32Array.BYTES_PER_ELEMENT,
    _dfn3_wasm_get_output_ptr: () => outputOffset * Float32Array.BYTES_PER_ELEMENT,
    _dfn3_wasm_process: () => {
      heap.copyWithin(outputOffset, inputOffset, inputOffset + FRAME_SIZE);
    },
    _dfn3_wasm_get_lsnr: () => 12,
    _dfn3_wasm_set_min_db_thresh: () => undefined,
    _dfn3_wasm_set_max_db_erb_thresh: () => undefined,
    _dfn3_wasm_set_max_db_df_thresh: () => undefined,
    _dfn3_wasm_set_atten_lim: () => undefined,
    _dfn3_wasm_set_post_filter_beta: () => undefined,
    _dfn3_wasm_set_hpf: () => undefined,
    _dfn3_wasm_agc_init: vi.fn(),
    _dfn3_wasm_set_input_agc: vi.fn(),
    _dfn3_wasm_set_output_agc: vi.fn(),
    _dfn3_wasm_set_output_agc_compression: vi.fn(),
  };
}

async function createProcessor(): Promise<{
  processor: WorkletProcessor;
  context: vm.Context;
  module: ReturnType<typeof createPassthroughModule>;
}> {
  const module = createPassthroughModule();
  let ProcessorClass: new (options: unknown) => WorkletProcessor;
  let clock = 0;
  const context = vm.createContext({
    ArrayBuffer,
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    Float32Array,
    Uint8Array,
    WebAssembly,
    currentFrame: 0,
    performance: { now: () => (clock += 0.25) },
    createDFN3Module: async () => module,
    registerProcessor: (
      _name: string,
      registered: new (options: unknown) => WorkletProcessor,
    ) => {
      ProcessorClass = registered;
    },
  });
  const source = readFileSync(
    join(process.cwd(), 'public/audio/deepfilternet3/dfn3-worklet.js'),
    'utf8',
  ).replace(/^\uFEFF?import[^\n]+\n/, '');
  vm.runInContext(source, context);

  const processor = new ProcessorClass!({
    processorOptions: {
      wasmBinary: new ArrayBuffer(8),
      weightsBinary: new ArrayBuffer(8),
    },
  });
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  expect(processor.port.messages).toContainEqual({ type: 'ready' });
  return { processor, context, module };
}

function render(
  processor: WorkletProcessor,
  context: vm.Context,
  input: Float32Array,
): Float32Array {
  const output = new Float32Array(input.length);
  for (let offset = 0; offset < input.length; offset += 128) {
    const quantum = input.slice(offset, offset + 128);
    const rendered = new Float32Array(quantum.length);
    context.currentFrame = offset;
    processor.process([[quantum]], [[rendered]]);
    output.set(rendered, offset);
  }
  return output;
}

describe('DeepFilterNet3 AudioWorklet streaming behavior', () => {
  it('bridges 128-sample quanta to 480-sample frames without drops or reorder', async () => {
    const { processor, context } = await createProcessor();
    const input = Float32Array.from(
      { length: 15360 },
      (_, index) => Math.sin(index * 0.013) * 0.4,
    );
    const output = render(processor, context, input);

    expect(Array.from(output.slice(0, PRIME_SAMPLES))).toEqual(
      Array(PRIME_SAMPLES).fill(0),
    );
    for (let index = PRIME_SAMPLES; index < output.length; index += 97) {
      expect(output[index]).toBeCloseTo(input[index - PRIME_SAMPLES], 6);
    }
    const perf = processor.port.messages.find(
      (message) => (message as { type?: string }).type === 'perf',
    ) as { droppedSamples?: number } | undefined;
    expect(perf?.droppedSamples).toBe(0);
  });

  it('does not turn a single impulse into an inverse repair ramp', async () => {
    const { processor, context } = await createProcessor();
    const input = new Float32Array(4096);
    input[1500] = 0.8;
    const output = render(processor, context, input);
    const impulseIndex = 1500 + PRIME_SAMPLES;
    const neighborhood = output.slice(impulseIndex - 4, impulseIndex + 140);

    expect(output[impulseIndex]).toBeCloseTo(0.8, 6);
    expect(Math.min(...neighborhood)).toBeGreaterThanOrEqual(-1e-7);
    const energy = neighborhood.reduce((sum, sample) => sum + sample * sample, 0);
    expect(energy).toBeCloseTo(0.64, 5);
  });

  it('compensates the disabled browser auto gain with the AGC placed after the model', async () => {
    const { module } = await createProcessor();

    expect(module._dfn3_wasm_agc_init).toHaveBeenCalled();
    expect(module._dfn3_wasm_set_output_agc_compression).toHaveBeenCalledWith(18);
    expect(module._dfn3_wasm_set_output_agc).toHaveBeenLastCalledWith(1);
    // Перед моделью усиление подняло бы заодно и шум, который она потом убирает.
    expect(module._dfn3_wasm_set_input_agc).toHaveBeenLastCalledWith(0);
  });

  it('switches the AGC off from the main thread without recreating the model', async () => {
    const { processor, module } = await createProcessor();

    processor.port.onmessage?.({ data: { type: 'auto-gain', enabled: false } });

    expect(module._dfn3_wasm_set_output_agc).toHaveBeenLastCalledWith(0);
    expect(module._dfn3_wasm_destroy).not.toHaveBeenCalled();
  });
});
