// Mirrors web/lib/vault-crypto.ts exactly — runs against the global.crypto
// polyfill installed by react-native-quick-crypto in index.ts.
//
// Wire format is identical to the web app so the same encrypted blobs work
// across web and mobile without any migration.

const PBKDF2_ITERATIONS = 200_000;

export interface EncryptedBlob {
  iv: string; // base64
  ct: string; // base64
}

// ── Base64 helpers ─────────────────────────────────────────────────────────────

export function toBase64(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const buf = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
  return buf;
}

function ab(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  if (u8.buffer instanceof ArrayBuffer) return u8 as Uint8Array<ArrayBuffer>;
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy;
}

// ── PBKDF2 ────────────────────────────────────────────────────────────────────

async function importPasswordMaterial(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await importPasswordMaterial(password);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: ab(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── AES-GCM ───────────────────────────────────────────────────────────────────

async function aesEncrypt(data: Uint8Array, key: CryptoKey): Promise<EncryptedBlob> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ab(data));
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

async function aesDecrypt(blob: EncryptedBlob, key: CryptoKey): Promise<Uint8Array> {
  const iv = fromBase64(blob.iv);
  const ct = fromBase64(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(iv) }, key, ab(ct));
  return new Uint8Array(pt);
}

// ── Master key wrap / unwrap ───────────────────────────────────────────────────

export async function decryptMasterKey(blob: EncryptedBlob, wrappingKey: CryptoKey): Promise<Uint8Array> {
  return aesDecrypt(blob, wrappingKey);
}

// ── Content encrypt / decrypt ─────────────────────────────────────────────────

async function importMasterKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ab(raw),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptContent(plaintext: string, masterKey: Uint8Array): Promise<EncryptedBlob> {
  const key = await importMasterKey(masterKey);
  return aesEncrypt(new TextEncoder().encode(plaintext), key);
}

export async function decryptContent(blob: EncryptedBlob | string, masterKey: Uint8Array): Promise<string> {
  const parsed: EncryptedBlob = typeof blob === 'string' ? JSON.parse(blob) : blob;
  const key = await importMasterKey(masterKey);
  return new TextDecoder().decode(await aesDecrypt(parsed, key));
}
