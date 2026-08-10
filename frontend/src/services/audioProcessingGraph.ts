export function configureMonoDestination(
  destination: Pick<
    AudioNode,
    'channelCount' | 'channelCountMode' | 'channelInterpretation'
  >,
): void {
  try {
    destination.channelCount = 1;
  } catch {
    // Some older browser implementations expose a read-only value.
  }
  try {
    destination.channelCountMode = 'explicit';
  } catch {
    // The encoded microphone track is still requested as mono.
  }
  try {
    destination.channelInterpretation = 'discrete';
  } catch {
    // Falling back to the browser default is safe, only less explicit.
  }
}

type GainParam = Pick<
  AudioParam,
  'value' | 'cancelScheduledValues' | 'setValueAtTime'
>;

const setImmediate = (param: GainParam, value: number, now: number): void => {
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
};

export function switchToDryBeforeTeardown(
  dry: GainParam,
  wet: GainParam,
  now: number,
  teardown: () => void,
): void {
  try {
    // Dry first: if teardown disconnects wet synchronously there is never a
    // render quantum where both branches are silent.
    setImmediate(dry, 1, now);
    setImmediate(wet, 0, now);
  } finally {
    teardown();
  }
}
