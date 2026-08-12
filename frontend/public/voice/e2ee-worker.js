const MAGIC = 0x4d434531;
const VERSION = 1;
const HEADER_BYTES = 26;
const REPLAY_WINDOW = 256n;
const sourceCodes = { microphone: 1, 'screen-audio': 2, 'screen-video': 3 };
const keys = new Map();
const epochSecrets = new Map();
const replayWindows = new Map();
let activeEpoch = '0';

function keyId(epoch, credentialId, source) {
  return `${epoch}|${credentialId}|${source}`;
}

async function mediaKey(epoch, credentialId, source) {
  const id = keyId(epoch, credentialId, source);
  const cached = keys.get(id);
  if (cached) return cached;
  const secret = epochSecrets.get(epoch);
  if (!secret) return undefined;
  const key = await crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(),
    info: new TextEncoder().encode(`miscord-media-v1\0${credentialId}\0${source}`),
  }, secret, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
  keys.set(id, key);
  return key;
}

function report(message) {
  self.postMessage({ type: 'e2ee-error', message });
}

function nonce(salt, counter) {
  const value = new Uint8Array(12);
  value.set(salt, 0);
  new DataView(value.buffer).setBigUint64(4, counter);
  return value;
}

function encodeHeader(source, epoch, counter, salt) {
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  view.setUint32(0, MAGIC);
  view.setUint8(4, VERSION);
  view.setUint8(5, sourceCodes[source] ?? 0);
  view.setBigUint64(6, BigInt(epoch));
  view.setBigUint64(14, counter);
  header.set(salt, 22);
  return header;
}

function decodeHeader(data, expectedSource) {
  if (data.byteLength <= HEADER_BYTES + 8) throw new Error('Encrypted frame is too short');
  const header = data.subarray(0, HEADER_BYTES);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0) !== MAGIC || view.getUint8(4) !== VERSION) {
    throw new Error('Plaintext or unsupported media frame rejected');
  }
  if (view.getUint8(5) !== sourceCodes[expectedSource]) throw new Error('Media source mismatch');
  return {
    header,
    epoch: view.getBigUint64(6).toString(),
    counter: view.getBigUint64(14),
    salt: header.slice(22, 26),
    ciphertext: data.subarray(HEADER_BYTES),
  };
}

function acceptCounter(sender, source, epoch, salt, counter) {
  const saltId = [...salt].map((item) => item.toString(16).padStart(2, '0')).join('');
  const id = `${sender}|${source}|${epoch}|${saltId}`;
  let state = replayWindows.get(id);
  if (!state) {
    state = { highest: counter, seen: new Set([counter]) };
    replayWindows.set(id, state);
    return true;
  }
  if (counter + REPLAY_WINDOW <= state.highest || state.seen.has(counter)) return false;
  if (counter > state.highest) state.highest = counter;
  state.seen.add(counter);
  const floor = state.highest > REPLAY_WINDOW ? state.highest - REPLAY_WINDOW : 0n;
  for (const value of state.seen) if (value < floor) state.seen.delete(value);
  return true;
}

async function encryptFrame(frame, options, state) {
  const epoch = activeEpoch;
  const key = await mediaKey(epoch, options.credentialId, options.source);
  if (!key) throw new Error('Sender media key is unavailable');
  state.counter += 1n;
  const header = encodeHeader(options.source, epoch, state.counter, state.salt);
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce(state.salt, state.counter), additionalData: header, tagLength: 64,
  }, key, frame.data);
  const output = new Uint8Array(header.byteLength + encrypted.byteLength);
  output.set(header);
  output.set(new Uint8Array(encrypted), header.byteLength);
  frame.data = output.buffer;
  return frame;
}

async function decryptFrame(frame, options) {
  const data = new Uint8Array(frame.data);
  const parsed = decodeHeader(data, options.source);
  const key = await mediaKey(parsed.epoch, options.credentialId, options.source);
  if (!key) throw new Error('Receiver media key is unavailable');
  if (!acceptCounter(
    options.credentialId, options.source, parsed.epoch, parsed.salt, parsed.counter,
  )) throw new Error('Replayed media frame rejected');
  frame.data = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: nonce(parsed.salt, parsed.counter),
    additionalData: parsed.header, tagLength: 64,
  }, key, parsed.ciphertext);
  return frame;
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'install-keys') return;
  const { requestId, epoch, secret } = event.data;
  void crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']).then((key) => {
    epochSecrets.set(epoch, key);
    activeEpoch = epoch;
    const minimum = BigInt(epoch) > 2n ? BigInt(epoch) - 2n : 0n;
    for (const keyEpoch of epochSecrets.keys()) {
      if (BigInt(keyEpoch) < minimum) epochSecrets.delete(keyEpoch);
    }
    for (const id of keys.keys()) {
      const keyEpoch = BigInt(id.slice(0, id.indexOf('|')));
      if (keyEpoch < minimum) keys.delete(id);
    }
    self.postMessage({ type: 'keys-installed', requestId, epoch });
  }).catch((error) => report(error instanceof Error ? error.message : String(error)));
});

self.addEventListener('rtctransform', (event) => {
  const transformer = event.transformer;
  const options = transformer.options;
  const state = { counter: 0n, salt: crypto.getRandomValues(new Uint8Array(4)) };
  const transform = new TransformStream({
    async transform(frame, controller) {
      try {
        const result = options.operation === 'encrypt'
          ? await encryptFrame(frame, options, state)
          : await decryptFrame(frame, options);
        controller.enqueue(result);
      } catch (error) {
        report(error instanceof Error ? error.message : String(error));
        // Fail closed: never forward a plaintext or unauthenticated frame.
      }
    },
  });
  transformer.readable.pipeThrough(transform).pipeTo(transformer.writable)
    .catch((error) => report(error instanceof Error ? error.message : String(error)));
});
