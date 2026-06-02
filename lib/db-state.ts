import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var __dbKey: string | undefined;
}

function saltPath(): string {
  const dbUrl = process.env.DATABASE_URL ?? "file:/app/db/dev.db";
  const dir = path.dirname(dbUrl.replace(/^file:/, ""));
  return path.join(dir, ".db_salt");
}

export function hasSalt(): boolean {
  return existsSync(saltPath());
}

export function loadSalt(): Buffer {
  const salt = Buffer.from(readFileSync(saltPath(), "utf8").trim(), "base64");
  if (salt.length !== 32) {
    throw new Error(
      "Salt file is corrupted (expected 32 bytes). The database cannot be unlocked without the original salt. Check that /app/db/.db_salt has not been truncated or replaced."
    );
  }
  return salt;
}

export function saveSalt(salt: Buffer): void {
  writeFileSync(saltPath(), salt.toString("base64"), { mode: 0o600 });
}

export function generateSalt(): Buffer {
  return randomBytes(32);
}

// PBKDF2-SHA256, 600k iterations — NIST SP 800-132 recommendation
export function deriveKey(passphrase: string, salt: Buffer): string {
  return pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256").toString("hex");
}

export function isDbUnlocked(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return !!global.__dbKey;
}

export function unlock(hexKey: string): void {
  global.__dbKey = hexKey;
  // Signal to middleware (same Node.js process, shared process.env) that the DB
  // is unlocked. No cookie needed — middleware reads this flag directly.
  process.env.NEXT_DB_UNLOCKED = "1";
}

export function lockDb(): void {
  global.__dbKey = undefined;
  delete process.env.NEXT_DB_UNLOCKED;
}

// Constant-time passphrase verification against the in-memory key.
export function verifyKey(passphrase: string): boolean {
  if (!global.__dbKey || !hasSalt()) return false;
  try {
    const salt = loadSalt();
    const candidate = Buffer.from(deriveKey(passphrase, salt), "hex");
    const stored    = Buffer.from(global.__dbKey, "hex");
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}
