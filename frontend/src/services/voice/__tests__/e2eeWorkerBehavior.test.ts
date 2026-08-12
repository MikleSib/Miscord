import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

type Listener = (event: any) => void;

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return copy;
}

function loadWorker() {
  const listeners = new Map<string, Listener>();
  const messages: any[] = [];
  const self = {
    crypto: webcrypto,
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    postMessage: (message: any) => messages.push(message),
  };
  const source = readFileSync(resolve(process.cwd(), 'public/voice/e2ee-worker.js'), 'utf8');
  vm.runInNewContext(source, {
    self, crypto: webcrypto, TextEncoder, Uint8Array, DataView, TransformStream,
    Map, Set, Promise, Error, BigInt,
  });
  return { listeners, messages };
}

async function transform(
  listener: Listener,
  operation: 'encrypt' | 'decrypt',
  frames: Array<{ data: ArrayBuffer }>,
) {
  const output: Array<{ data: ArrayBuffer }> = [];
  const readable = new ReadableStream({
    start(controller) {
      frames.forEach((frame) => controller.enqueue(frame));
      controller.close();
    },
  });
  const writable = new WritableStream({ write: (frame) => { output.push(frame); } });
  listener({ transformer: {
    readable, writable,
    options: { operation, credentialId: '42:session-a', source: 'microphone' },
  } });
  await vi.waitFor(() => expect(output.length).toBeGreaterThanOrEqual(operation === 'encrypt' ? 1 : 0));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  return output;
}

describe('voice E2EE encoded transform', () => {
  it('round-trips ciphertext, rejects tampering, and drops replays', async () => {
    const worker = loadWorker();
    const secret = webcrypto.getRandomValues(new Uint8Array(32));
    worker.listeners.get('message')!({ data: {
      type: 'install-keys', requestId: 'request-1', epoch: '7', secret: toArrayBuffer(secret),
    } });
    await vi.waitFor(() => expect(worker.messages).toContainEqual({
      type: 'keys-installed', requestId: 'request-1', epoch: '7',
    }));

    const plaintext = toArrayBuffer(new TextEncoder().encode('encoded opus frame'));
    const encrypted = await transform(worker.listeners.get('rtctransform')!, 'encrypt', [{ data: plaintext }]);
    expect(new Uint8Array(encrypted[0]!.data)).not.toEqual(new Uint8Array(plaintext));
    const ciphertext = encrypted[0]!.data.slice(0);

    const decrypted = await transform(worker.listeners.get('rtctransform')!, 'decrypt', encrypted);
    expect(new Uint8Array(decrypted[0]!.data)).toEqual(new Uint8Array(plaintext));

    const replayed = await transform(worker.listeners.get('rtctransform')!, 'decrypt', [{ data: ciphertext }]);
    expect(replayed).toHaveLength(0);
    await vi.waitFor(() => expect(worker.messages.some(({ type, message }) =>
      type === 'e2ee-error' && String(message).includes('Replayed'))).toBe(true));

    const fresh = await transform(worker.listeners.get('rtctransform')!, 'encrypt', [{ data: plaintext }]);
    const tampered = fresh[0]!.data.slice(0);
    const bytes = new Uint8Array(tampered);
    bytes[bytes.length - 1] ^= 1;
    const rejected = await transform(worker.listeners.get('rtctransform')!, 'decrypt', [{ data: tampered }]);
    expect(rejected).toHaveLength(0);
  });
});
