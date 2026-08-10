/** Serializes bot Identify setup per session without blocking unrelated sessions. */
export class SessionIdentifyQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const settled = result.then(() => undefined, () => undefined);
    let tracked!: Promise<void>;
    tracked = settled.finally(() => {
      if (this.tails.get(sessionId) === tracked) this.tails.delete(sessionId);
    });
    this.tails.set(sessionId, tracked);
    return result;
  }

  size(): number {
    return this.tails.size;
  }
}
