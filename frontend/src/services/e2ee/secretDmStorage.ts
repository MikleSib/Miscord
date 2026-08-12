interface EncryptedRecord {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

const DB_NAME = 'miscord-secret-dm-v1';
const DB_VERSION = 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Encrypted storage could not be opened'));
  });
}

async function getValue<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error || new Error('Encrypted record could not be read'));
    transaction.oncomplete = () => db.close();
  });
}

async function putValue(storeName: string, key: IDBValidKey, value: unknown): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value, key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Encrypted record could not be saved')); };
  });
}

async function wrappingKey(): Promise<CryptoKey> {
  const existing = await getValue<CryptoKey>('keys', 'device-wrapping-key');
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await putValue('keys', 'device-wrapping-key', key);
  return key;
}

async function seal(value: string, context: string): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: textEncoder.encode(context), tagLength: 128 },
    await wrappingKey(), textEncoder.encode(value),
  );
  return { iv, ciphertext };
}

async function open(record: EncryptedRecord, context: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv, additionalData: textEncoder.encode(context), tagLength: 128 },
    await wrappingKey(), record.ciphertext,
  );
  return textDecoder.decode(plaintext);
}

export async function loadSecretState(userId: number): Promise<string | null> {
  const context = `state:${userId}`;
  const record = await getValue<EncryptedRecord>('state', context);
  return record ? open(record, context) : null;
}

export async function saveSecretState(userId: number, value: string): Promise<void> {
  const context = `state:${userId}`;
  await putValue('state', context, await seal(value, context));
}

export async function loadSecretPlaintext(userId: number, key: string): Promise<string | null> {
  const context = `message:${userId}:${key}`;
  const record = await getValue<EncryptedRecord>('messages', context);
  return record ? open(record, context) : null;
}

export async function saveSecretPlaintext(userId: number, key: string, value: string): Promise<void> {
  const context = `message:${userId}:${key}`;
  await putValue('messages', context, await seal(value, context));
}
