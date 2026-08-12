import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnifiedWebSocketReadiness } from '../unifiedWebSocketReadiness';

describe('UnifiedWebSocketReadiness', () => {
  afterEach(() => vi.useRealTimers());

  it('releases pending voice joins only after Gateway identify', async () => {
    const readiness = new UnifiedWebSocketReadiness();
    let completed = false;
    const waiting = readiness.wait().then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);
    readiness.markReady();
    await waiting;
    expect(completed).toBe(true);
    expect(readiness.isReady).toBe(true);
  });

  it('keeps a pending join across reconnect and resolves on the next identify', async () => {
    const readiness = new UnifiedWebSocketReadiness();
    const waiting = readiness.wait();
    readiness.markUnavailable();
    readiness.markReady();
    await expect(waiting).resolves.toBeUndefined();
  });

  it('returns a clear Gateway error when reconnect never completes', async () => {
    vi.useFakeTimers();
    const readiness = new UnifiedWebSocketReadiness();
    const waiting = readiness.wait(5_000);
    const assertion = expect(waiting).rejects.toThrow('Соединение с сервером не восстановилось');
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('rejects pending joins immediately on an intentional disconnect', async () => {
    const readiness = new UnifiedWebSocketReadiness();
    const waiting = readiness.wait();
    readiness.fail(new Error('Соединение закрыто'));
    await expect(waiting).rejects.toThrow('Соединение закрыто');
  });
});
