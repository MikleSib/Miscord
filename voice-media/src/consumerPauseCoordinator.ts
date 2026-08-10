import type { Consumer } from 'mediasoup/types';

interface Waiter {
  version: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PauseState {
  desiredUser: boolean;
  desiredActivity: boolean;
  desiredServer: boolean;
  appliedPaused: boolean;
  requestedVersion: number;
  completedVersion: number;
  running: boolean;
  waiters: Waiter[];
}

/** Serializes the two independent pause reasons into one mediasoup state. */
export class ConsumerPauseCoordinator {
  private readonly states = new WeakMap<Consumer, PauseState>();

  register(consumer: Consumer): void {
    this.states.set(consumer, {
      desiredUser: Boolean(consumer.appData.userPaused),
      desiredActivity: Boolean(consumer.appData.activityPaused),
      desiredServer: Boolean(consumer.appData.serverPaused),
      appliedPaused: Boolean(consumer.paused),
      requestedVersion: 0,
      completedVersion: 0,
      running: false,
      waiters: [],
    });
  }

  unregister(consumer: Consumer): void {
    const state = this.states.get(consumer);
    if (!state) return;
    state.waiters.splice(0).forEach((waiter) => waiter.resolve());
    this.states.delete(consumer);
  }

  setUserPaused(consumer: Consumer, paused: boolean): Promise<void> {
    return this.request(consumer, (state) => { state.desiredUser = paused; });
  }

  setActivityPaused(consumer: Consumer, paused: boolean): Promise<void> {
    return this.request(consumer, (state) => { state.desiredActivity = paused; });
  }

  setServerPaused(consumer: Consumer, paused: boolean): Promise<void> {
    return this.request(consumer, (state) => { state.desiredServer = paused; });
  }

  private request(consumer: Consumer, update: (state: PauseState) => void): Promise<void> {
    const state = this.requireState(consumer);
    update(state);
    const version = ++state.requestedVersion;
    const completion = new Promise<void>((resolve, reject) => {
      state.waiters.push({ version, resolve, reject });
    });
    this.ensureRunning(consumer, state);
    return completion;
  }

  private ensureRunning(consumer: Consumer, state: PauseState): void {
    if (state.running) return;
    state.running = true;
    void Promise.resolve().then(() => this.drain(consumer, state)).finally(() => {
      state.running = false;
      if (state.requestedVersion > state.completedVersion && this.states.get(consumer) === state) {
        this.ensureRunning(consumer, state);
      }
    });
  }

  private async drain(consumer: Consumer, state: PauseState): Promise<void> {
    while (state.completedVersion < state.requestedVersion && this.states.get(consumer) === state) {
      const version = state.requestedVersion;
      const desiredUser = state.desiredUser;
      const desiredActivity = state.desiredActivity;
      const desiredServer = state.desiredServer;
      const desiredPaused = desiredUser || desiredActivity || desiredServer;
      try {
        if (state.appliedPaused !== desiredPaused) {
          if (desiredPaused) await consumer.pause();
          else await consumer.resume();
        }
        if (this.states.get(consumer) !== state) return;
        state.appliedPaused = desiredPaused;
        consumer.appData.userPaused = desiredUser;
        consumer.appData.activityPaused = desiredActivity;
        consumer.appData.serverPaused = desiredServer;
        this.settle(state, version);
      } catch (error) {
        this.settle(state, version, error);
      }
    }
  }

  private settle(state: PauseState, version: number, error?: unknown): void {
    state.completedVersion = version;
    const count = state.waiters.findIndex((waiter) => waiter.version > version);
    const ready = state.waiters.splice(0, count < 0 ? state.waiters.length : count);
    for (const waiter of ready) {
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  }

  private requireState(consumer: Consumer): PauseState {
    const state = this.states.get(consumer);
    if (!state) throw new Error('Consumer pause state is unavailable');
    return state;
  }
}
