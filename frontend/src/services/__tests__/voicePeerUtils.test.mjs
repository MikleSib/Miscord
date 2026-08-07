import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Контракт mesh-голосового канала (должен совпадать с voicePeerUtils.ts / iceServers.ts).
 */
function shouldCreateOffer(localUserId, remoteUserId) {
  if (localUserId === null || Number.isNaN(localUserId)) return false;
  return localUserId < remoteUserId;
}

function canAcceptAnswer(signalingState) {
  return signalingState === 'have-local-offer';
}

function shouldBufferIceCandidate(hasPeer, hasRemoteDescription) {
  return !hasPeer || !hasRemoteDescription;
}

function isBrokenTurn(entry) {
  const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls]).map(String);
  return urls.some(
    (url) =>
      url.includes('miscord.ru:3478') ||
      url.includes('127.0.0.1') ||
      url.includes('localhost')
  );
}

function mergeIceServers(serverIce = []) {
  const workingTurn = {
    urls: [
      'turn:147.45.158.183:3478?transport=udp',
      'turn:147.45.158.183:3478?transport=tcp',
    ],
    username: 'stream-cash',
    credential: 'CHANGE_ME_LONG_RANDOM_SECRET_12345',
  };
  const seen = new Set();
  const merged = [];
  const push = (entry) => {
    if (!entry || isBrokenTurn(entry)) return;
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls]).filter(Boolean);
    if (urls.length === 0) return;
    const key = `${urls.slice().sort().join('|')}|${entry.username || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ ...entry, urls });
  };
  push({ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] });
  push(workingTurn);
  for (const entry of serverIce) push(entry);
  return merged;
}

test('меньший user_id создаёт offer (без glare)', () => {
  assert.equal(shouldCreateOffer(1, 2), true);
  assert.equal(shouldCreateOffer(2, 1), false);
  assert.equal(shouldCreateOffer(null, 2), false);
});

test('answer принимается только в have-local-offer', () => {
  assert.equal(canAcceptAnswer('have-local-offer'), true);
  assert.equal(canAcceptAnswer('stable'), false);
});

test('ICE буферизуется до peer/remoteDescription', () => {
  assert.equal(shouldBufferIceCandidate(false, false), true);
  assert.equal(shouldBufferIceCandidate(true, false), true);
  assert.equal(shouldBufferIceCandidate(true, true), false);
});

test('ICE servers всегда содержат запасной TURN', () => {
  const ice = mergeIceServers([{ urls: ['stun:stun.l.google.com:19302'] }]);
  assert.ok(ice.some((s) => String(s.urls).includes('turn:147.45.158.183')));
  assert.ok(ice.length >= 2);
});

test('битый TURN miscord.ru выкидывается', () => {
  const ice = mergeIceServers([
    {
      urls: ['turn:miscord.ru:3478?transport=udp'],
      username: 'miscord',
      credential: 'x',
    },
  ]);
  assert.ok(ice.every((s) => !String(s.urls).includes('miscord.ru:3478')));
  assert.ok(ice.some((s) => String(s.urls).includes('147.45.158.183')));
});
