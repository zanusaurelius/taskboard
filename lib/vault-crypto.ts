"use client";

// All functions run in the browser using the Web Crypto API.

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 32;

export interface EncryptedBlob {
  iv: string;  // base64
  ct: string;  // base64
}

// ── Base64 helpers ──────────────────────────────────────────────────────────

export function toBase64(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const buf = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
  return buf;
}

// ── Key generation ──────────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

// Coerce Uint8Array to have plain ArrayBuffer backing (required by Web Crypto in TS 5.7+)
function ab(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  if (u8.buffer instanceof ArrayBuffer) return u8 as Uint8Array<ArrayBuffer>;
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy;
}

export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

export function generateMasterKey(): Uint8Array {
  return randomBytes(32);
}

// Recovery code: 4 groups of 6 chars from an unambiguous alphabet
export function generateRecoveryCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(24);
  const parts: string[] = [];
  for (let g = 0; g < 4; g++) {
    let part = "";
    for (let i = 0; i < 6; i++) part += chars[bytes[g * 6 + i] % chars.length];
    parts.push(part);
  }
  return parts.join("-");
}

// ── PBKDF2 ──────────────────────────────────────────────────────────────────

async function importPasswordMaterial(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await importPasswordMaterial(password);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: ab(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── AES-GCM encrypt / decrypt ───────────────────────────────────────────────

async function aesEncrypt(data: Uint8Array, key: CryptoKey): Promise<EncryptedBlob> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ab(data));
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

async function aesDecrypt(blob: EncryptedBlob, key: CryptoKey): Promise<Uint8Array> {
  const iv = fromBase64(blob.iv);
  const ct = fromBase64(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}

// ── Master key wrap / unwrap ─────────────────────────────────────────────────

export async function encryptMasterKey(masterKey: Uint8Array, wrappingKey: CryptoKey): Promise<EncryptedBlob> {
  return aesEncrypt(masterKey, wrappingKey);
}

export async function decryptMasterKey(blob: EncryptedBlob, wrappingKey: CryptoKey): Promise<Uint8Array> {
  return aesDecrypt(blob, wrappingKey);
}

// ── Content encrypt / decrypt ────────────────────────────────────────────────

async function importMasterKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", ab(raw), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptContent(plaintext: string, masterKey: Uint8Array): Promise<EncryptedBlob> {
  const key = await importMasterKey(masterKey);
  return aesEncrypt(new TextEncoder().encode(plaintext), key);
}

export async function decryptContent(blob: EncryptedBlob, masterKey: Uint8Array): Promise<string> {
  const key = await importMasterKey(masterKey);
  return new TextDecoder().decode(await aesDecrypt(blob, key));
}

// ── Verifier ─────────────────────────────────────────────────────────────────
// SHA-256(masterKey) — stored on server so it can confirm correct key without seeing the key itself.

export async function computeVerifier(masterKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", ab(masterKey));
  return toBase64(new Uint8Array(hash));
}
