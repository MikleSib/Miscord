/**
 * Общие ICE-серверы для WebRTC.
 * TURN обязателен для телефон↔ПК / разных NAT.
 *
 * miscord.ru:3478 намеренно НЕ используем: coturn часто слушает только LAN
 * и даёт 6–10с тишины или полный обрыв, пока браузер ждёт таймаут.
 */
const WORKING_TURN: RTCIceServer = {
  urls: [
    'turn:147.45.158.183:3478?transport=udp',
    'turn:147.45.158.183:3478?transport=tcp',
  ],
  username: 'stream-cash',
  credential: 'CHANGE_ME_LONG_RANDOM_SECRET_12345',
};

export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  WORKING_TURN,
];

function normalizeUrls(urls: string | string[]): string[] {
  return (Array.isArray(urls) ? urls : [urls]).map((url) => url.trim()).filter(Boolean);
}

function entryKey(entry: RTCIceServer): string {
  const urls = normalizeUrls(entry.urls as string | string[]);
  return `${urls.slice().sort().join('|')}|${entry.username || ''}|${entry.credential || ''}`;
}

/** Отбрасываем заведомо проблемные TURN (локальный coturn / localhost). */
function isBrokenTurn(entry: RTCIceServer): boolean {
  const urls = normalizeUrls(entry.urls as string | string[]);
  return urls.some(
    (url) =>
      url.includes('miscord.ru:3478') ||
      url.includes('127.0.0.1') ||
      url.includes('localhost')
  );
}

/** Склеивает серверные ICE с рабочим TURN. Битые TURN выкидываем. */
export function mergeIceServers(serverIce?: RTCIceServer[] | null): RTCIceServer[] {
  const seen = new Set<string>();
  const merged: RTCIceServer[] = [];

  const push = (entry: RTCIceServer | null | undefined) => {
    if (!entry || isBrokenTurn(entry)) return;
    const urls = normalizeUrls(entry.urls as string | string[]);
    if (urls.length === 0) return;
    const key = entryKey({ ...entry, urls });
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      urls,
      username: entry.username,
      credential: entry.credential,
    });
  };

  push({ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] });
  push(WORKING_TURN);

  for (const entry of serverIce || []) {
    push(entry);
  }
  for (const entry of FALLBACK_ICE_SERVERS) {
    push(entry);
  }

  return merged.length > 0 ? merged : FALLBACK_ICE_SERVERS;
}
