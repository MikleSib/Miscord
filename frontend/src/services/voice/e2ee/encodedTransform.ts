type TransformTarget = { transform?: unknown };
type ScriptTransformConstructor = new (
  worker: Worker,
  options: Record<string, unknown>,
) => unknown;

function scriptTransformConstructor(): ScriptTransformConstructor {
  const constructor = (globalThis as unknown as {
    RTCRtpScriptTransform?: ScriptTransformConstructor;
  }).RTCRtpScriptTransform;
  if (!constructor) {
    throw new Error('Браузер не поддерживает сквозное шифрование голосовых каналов.');
  }
  return constructor;
}

export function assertEncodedTransformSupport(): void {
  scriptTransformConstructor();
  if (typeof Worker === 'undefined' || !globalThis.crypto?.subtle) {
    throw new Error('Криптографический модуль браузера недоступен.');
  }
}

export function attachSenderTransform(
  sender: RTCRtpSender | undefined,
  worker: Worker,
  credentialId: string,
  source: string,
): void {
  if (!sender) throw new Error('WebRTC sender недоступен для сквозного шифрования.');
  (sender as TransformTarget).transform = new (scriptTransformConstructor())(worker, {
    operation: 'encrypt', credentialId, source,
  });
}

export function attachReceiverTransform(
  receiver: RTCRtpReceiver | undefined,
  worker: Worker,
  credentialId: string,
  source: string,
): void {
  if (!receiver) throw new Error('WebRTC receiver недоступен для сквозного шифрования.');
  (receiver as TransformTarget).transform = new (scriptTransformConstructor())(worker, {
    operation: 'decrypt', credentialId, source,
  });
}
