export type AssertCurrentVoiceLifecycle = () => void;

export class VoiceLifecycleSupersededError extends Error {
  constructor() {
    super('Voice lifecycle operation was superseded');
    this.name = 'VoiceLifecycleSupersededError';
  }
}

export class VoiceLifecycle {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;

  runLatest<T>(task: (assertCurrent: AssertCurrentVoiceLifecycle) => Promise<T>): Promise<T> {
    const generation = ++this.generation;
    return this.enqueue(() => task(() => {
      if (generation !== this.generation) throw new VoiceLifecycleSupersededError();
    }));
  }

  cancelAndRun(task: () => Promise<void>): Promise<void> {
    this.generation += 1;
    return this.enqueue(task);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => task(), () => task());
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
