import { describe, expect, it, vi } from 'vitest';

import { E2eeCoordinator, type E2eeHello } from './e2eeCoordinator.js';

function encoded(value: string): string {
  return Buffer.from(value).toString('base64');
}

function hello(credentialId: string): E2eeHello {
  return { protocol_version: 1, credential_id: credentialId, key_package: encoded(`kp:${credentialId}`) };
}

function socket() {
  return { close: vi.fn() } as never;
}

describe('E2eeCoordinator', () => {
  it('serializes MLS add/remove epochs without ever receiving a media key', async () => {
    const events: Array<{ sessionId: string; type: string; data: Record<string, unknown> }> = [];
    const transitioning = vi.fn(async () => undefined);
    const coordinator = new E2eeCoordinator('room-1', {
      send: (sessionId, type, data) => events.push({ sessionId, type, data }),
      sendBot: vi.fn(),
      setTransitioning: transitioning,
      disconnectAll: vi.fn(),
    });

    expect(coordinator.register('a', '1:a', socket(), hello('1:a'))).toMatchObject({ action: 'create' });
    await coordinator.epochReady('a', '0');
    expect(coordinator.isReady('a')).toBe(true);

    expect(coordinator.register('b', '2:b', socket(), hello('2:b'))).toMatchObject({ action: 'wait' });
    await vi.waitFor(() => expect(events.some(({ type }) => type === 'e2ee_add_member')).toBe(true));
    await coordinator.commitAdd(
      'a', 'b', '1', encoded('commit-1'), encoded('welcome-1'), encoded('tree-1'),
    );
    expect(coordinator.isReady('a')).toBe(false);
    expect(events.find(({ type }) => type === 'e2ee_welcome')?.sessionId).toBe('b');
    await coordinator.epochReady('b', '1');
    expect(coordinator.isReady('a')).toBe(true);
    expect(coordinator.isReady('b')).toBe(true);

    coordinator.register('c', '3:c', socket(), hello('3:c'));
    await vi.waitFor(() => expect(events.filter(({ type }) => type === 'e2ee_add_member')).toHaveLength(2));
    await coordinator.commitAdd(
      'a', 'c', '2', encoded('commit-2'), encoded('welcome-2'), encoded('tree-2'),
    );
    expect(events.some(({ sessionId, type }) => sessionId === 'b' && type === 'e2ee_commit')).toBe(true);
    await coordinator.epochReady('b', '2');
    await coordinator.epochReady('c', '2');
    expect(coordinator.isReady('c')).toBe(true);

    await coordinator.unregister('b');
    expect(events.some(({ sessionId, type }) => sessionId === 'a' && type === 'e2ee_remove_member')).toBe(true);
    await coordinator.commitRemove('a', '2:b', '3', encoded('commit-3'));
    await coordinator.epochReady('c', '3');
    expect(coordinator.isReady('a')).toBe(true);
    expect(coordinator.isReady('c')).toBe(true);
    expect(transitioning).toHaveBeenCalledWith(true);
    expect(transitioning).toHaveBeenLastCalledWith(false);
    coordinator.close();
  });

  it('rejects unscoped, non-canonical, and oversized key packages', () => {
    const coordinator = new E2eeCoordinator('room-2', {
      send: vi.fn(), sendBot: vi.fn(),
      setTransitioning: vi.fn(async () => undefined), disconnectAll: vi.fn(),
    });
    expect(() => coordinator.register('a', '1:a', socket(), hello('other'))).toThrow('scope mismatch');
    expect(() => coordinator.register('a', '1:a', socket(), {
      ...hello('1:a'), key_package: 'not base64',
    })).toThrow('must be base64');
    expect(() => coordinator.register('a', '1:a', socket(), {
      ...hello('1:a'), key_package: Buffer.alloc(16 * 1024 + 1).toString('base64'),
    })).toThrow('invalid size');
    coordinator.close();
  });

  it('rotates MLS epochs when an encrypted bot joins and leaves', async () => {
    const humanEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
    const botEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
    const coordinator = new E2eeCoordinator('room-with-bot', {
      send: (_sessionId, type, data) => humanEvents.push({ type, data }),
      sendBot: (_sessionId, type, data) => botEvents.push({ type, data }),
      setTransitioning: vi.fn(async () => undefined),
      disconnectAll: vi.fn(),
    });
    coordinator.register('human', '1:human', socket(), hello('1:human'));
    await coordinator.epochReady('human', '0');
    coordinator.registerBot('bot', '2:bot', {
      protocol_version: 1, credential_id: '2:bot', public_key: encoded('spki'),
    });
    await vi.waitFor(() => expect(
      humanEvents.some(({ type }) => type === 'e2ee_rotate_epoch'),
    ).toBe(true));
    const envelope = {
      session_id: 'bot', credential_id: '2:bot',
      ephemeral_key: encoded('ephemeral'), salt: encoded('salt'),
      iv: encoded('twelve-byte!'), ciphertext: encoded('ciphertext-and-tag'),
    };
    await coordinator.commitRotate(
      'human', 'bot', '1', encoded('rotate-add'), [envelope],
    );
    expect(botEvents.some(({ type }) => type === 'e2ee_prepare_epoch')).toBe(true);
    await coordinator.botEpochReady('bot', '1');
    expect(coordinator.isBotReady('bot')).toBe(true);

    await coordinator.unregisterBot('bot');
    await vi.waitFor(() => expect(
      humanEvents.filter(({ type }) => type === 'e2ee_rotate_epoch'),
    ).toHaveLength(2));
    await coordinator.commitRotate('human', 'bot', '2', encoded('rotate-remove'), []);
    expect(coordinator.isReady('human')).toBe(true);
    expect(coordinator.isBotReady('bot')).toBe(false);
    coordinator.close();
  });
});
