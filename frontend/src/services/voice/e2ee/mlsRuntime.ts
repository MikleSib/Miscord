import type { MlsModule } from './mlsTypes';

let modulePromise: Promise<MlsModule> | undefined;

export function loadMlsModule(): Promise<MlsModule> {
  if (!modulePromise) {
    const moduleUrl = '/crypto/mls/miscord_mls.js';
    modulePromise = import(/* webpackIgnore: true */ moduleUrl)
      .then(async (module) => {
        const typed = module as unknown as MlsModule;
        await typed.default('/crypto/mls/miscord_mls_bg.wasm');
        return typed;
      })
      .catch((error) => {
        modulePromise = undefined;
        throw error;
      });
  }
  return modulePromise;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
