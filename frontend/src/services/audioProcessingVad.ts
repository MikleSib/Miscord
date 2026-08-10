import { MicVAD } from '@ricky0123/vad-web';

interface VadCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onMisfire: () => void;
}

const getAssetOrigin = (): string =>
  typeof window !== 'undefined' ? `${window.location.origin}/` : '/';

export async function preloadVadRuntime(): Promise<void> {
  if (typeof AudioContext === 'undefined') return;

  let context: AudioContext | null = null;
  let vad: MicVAD | null = null;
  try {
    context = new AudioContext({ sampleRate: 48000 });
    const silence = context.createMediaStreamDestination();
    const assetOrigin = getAssetOrigin();
    vad = await MicVAD.new({
      getStream: async () => silence.stream,
      pauseStream: async () => undefined,
      resumeStream: async () => silence.stream,
      baseAssetPath: assetOrigin,
      onnxWASMBasePath: `${assetOrigin}onnx/`,
    });
  } catch (error) {
    console.warn('[Audio] Не удалось прогреть VAD заранее:', error);
  } finally {
    try {
      await vad?.destroy();
    } catch {
      // Прогрев не влияет на работоспособность звонка.
    }
    try {
      await context?.close();
    } catch {
      // Контекст уже мог закрыться сам.
    }
  }
}

export async function createVad(
  stream: MediaStream,
  threshold: number,
  callbacks: VadCallbacks,
): Promise<MicVAD> {
  const assetOrigin = getAssetOrigin();
  const vad = await MicVAD.new({
    getStream: async () => stream,
    pauseStream: async () => undefined,
    resumeStream: async () => stream,
    baseAssetPath: assetOrigin,
    onnxWASMBasePath: `${assetOrigin}onnx/`,
    onSpeechStart: callbacks.onSpeechStart,
    onSpeechEnd: callbacks.onSpeechEnd,
    onVADMisfire: callbacks.onMisfire,
    positiveSpeechThreshold: threshold,
    negativeSpeechThreshold: Math.max(0.05, threshold - 0.15),
    redemptionMs: 768,
    preSpeechPadMs: 384,
    minSpeechMs: 384,
  });
  try {
    await vad.start();
    return vad;
  } catch (error) {
    try {
      await vad.destroy();
    } catch (cleanupError) {
      console.warn('[Audio] Failed to clean up VAD after start error:', cleanupError);
    }
    throw error;
  }
}
