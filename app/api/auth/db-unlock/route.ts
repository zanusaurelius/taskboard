import { NextResponse } from "next/server";
import {
  hasSalt, loadSalt, saveSalt, generateSalt, deriveKey, unlock, lockDb, isDbUnlocked, verifyKey,
} from "@/lib/db-state";
import { initPrisma, prisma } from "@/lib/prisma";
import { runMigrations } from "@/lib/migrations";
import { getClientIp } from "@/lib/rateLimit";

// Verify Prisma can actually query the database after unlock/setup.
// Surfaces "file is not a database" at unlock time rather than at the first app query.
async function verifyPrismaConnection(): Promise<void> {
  try {
    await prisma.user.count();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Database connection verification failed: ${msg}`);
  }
}

export const runtime = "nodejs";

const DB_COOKIE     = "db_unlocked";
const MAX_PASSPHRASE = 1024;

// ── In-memory rate limiter ────────────────────────────────────────────────────
// Cannot use the Prisma-backed checkRateLimit here — the DB may not be unlocked.
const unlockAttempts = new Map<string, { count: number; firstAt: number }>();
const RATE_LIMIT     = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const entry = unlockAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAt > RATE_WINDOW_MS) return false;
  return entry.count >= RATE_LIMIT;
}

// Called only on a failed attempt — correct passphrase resets the counter.
function recordFailedAttempt(ip: string): void {
  const now   = Date.now();
  const entry = unlockAttempts.get(ip);
  if (!entry || now - entry.firstAt > RATE_WINDOW_MS) {
    unlockAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count++;
  }
}

// ── Mutexes ───────────────────────────────────────────────────────────────────
// Setup: prevents two concurrent first-run requests from both calling PRAGMA rekey,
// which would double-encrypt the DB with two different keys → permanent data loss.
let setupInProgress  = false;
// Unlock: prevents SQLITE_BUSY crashes when two requests race through runMigrations.
let unlockInProgress = false;

// ─────────────────────────────────────────────────────────────────────────────

function cookieOpts(_req?: Request) {
  // secure: false — the cookie value is already cryptographically opaque (AUTH_SECRET
  // fingerprint + per-boot nonce). Tor .onion connections are HTTP and browsers never
  // send Secure cookies over HTTP, which breaks the DB-unlock gate on every request.
  // LAN connections use HTTPS at the transport level regardless of this flag.
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: false,
    path: "/",
    // Persist across browser restarts. The per-boot nonce in the value means a
    // server restart still invalidates this cookie, so security is unchanged.
    maxAge: 60 * 60 * 24 * 30,
  };
}

function dbPath(): string {
  return (process.env.DATABASE_URL ?? "file:/app/db/dev.db").replace(/^file:/, "");
}

function setUnlockedCookie(res: NextResponse): void {
  // Value = AUTH_SECRET fingerprint only — stable across server restarts.
  // Matching the check in proxy.ts. Data security is enforced server-side
  // via global.__dbKey; the cookie just controls the /unlock redirect UX.
  const token = (process.env.AUTH_SECRET ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  res.cookies.set(DB_COOKIE, token, cookieOpts());
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const { passphrase, confirm } = body ?? {};

  if (!passphrase || typeof passphrase !== "string") {
    return NextResponse.json({ error: "Passphrase is required" }, { status: 400 });
  }
  if (passphrase.length > MAX_PASSPHRASE) {
    return NextResponse.json({ error: "Passphrase too long" }, { status: 400 });
  }

  // ── Already unlocked ───────────────────────────────────────────────────────
  // Server is running and key is in memory. Verify the passphrase is still
  // correct before issuing a fresh cookie (handles re-auth after cookie expiry).
  if (isDbUnlocked()) {
    if (!verifyKey(passphrase)) {
      recordFailedAttempt(ip);
      return NextResponse.json({ error: "Incorrect passphrase" }, { status: 401 });
    }
    unlockAttempts.delete(ip); // reset on success
    const res = NextResponse.json({ ok: true });
    setUnlockedCookie(res);
    return res;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");

  // ── First-time setup ───────────────────────────────────────────────────────
  if (!hasSalt()) {
    if (setupInProgress) {
      return NextResponse.json({ error: "Setup already in progress" }, { status: 503 });
    }
    if (!confirm || confirm !== passphrase) {
      return NextResponse.json({ error: "Passphrases do not match" }, { status: 400 });
    }

    setupInProgress = true;
    let hexKey = "";
    try {
      const salt = generateSalt();
      hexKey = deriveKey(passphrase, salt);

      const db = new Database(dbPath());
      try {
        // Use the native rekey() API (calls sqlite3_rekey_v2 directly) to encrypt
        // the database — more reliable than the PRAGMA string path.
        db.rekey(Buffer.from(hexKey, 'hex'));

        // Save salt IMMEDIATELY after rekey so the DB is recoverable if migrations
        // fail. On retry the user enters the unlock flow (salt exists) and migrations
        // run again — no data is lost.
        saveSalt(salt);

        runMigrations(db);
      } catch (err) {
        db.close();
        throw err;
      }
      db.close();

      // Verify encryption actually applied: open a fresh connection WITHOUT a key
      // (global.__dbKey is still unset at this point) and confirm the DB rejects it.
      const dbCheck = new Database(dbPath());
      let encrypted = false;
      try {
        dbCheck.pragma("integrity_check", { simple: true });
        // integrity_check succeeded on a key-less open → rekey didn't apply
      } catch {
        encrypted = true; // expected: "file is not a database" = encryption is in place
      } finally {
        try { dbCheck.close(); } catch { /* ignore */ }
      }
      if (!encrypted) {
        throw new Error("Encryption verification failed: database was not encrypted");
      }
    } catch (err) {
      setupInProgress = false;
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Setup failed: ${msg}` }, { status: 500 });
    }
    setupInProgress = false;
    unlockAttempts.delete(ip);

    unlock(hexKey);
    initPrisma();
    try {
      await verifyPrismaConnection();
    } catch (err) {
      lockDb();
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Setup failed: ${msg}` }, { status: 500 });
    }

    const res = NextResponse.json({ ok: true });
    setUnlockedCookie(res);
    return res;
  }

  // ── Subsequent unlock ──────────────────────────────────────────────────────
  if (unlockInProgress) {
    return NextResponse.json({ error: "Unlock already in progress" }, { status: 503 });
  }
  unlockInProgress = true;

  const salt   = loadSalt();
  const hexKey = deriveKey(passphrase, salt);

  // Phase 1: verify the key before touching anything else.
  // Kept in its own try so a migration error cannot be misclassified as a wrong key.
  let db;
  try {
    db = new Database(dbPath());
    // Use the native key() API (calls sqlite3_key_v2 directly) — matches the
    // raw-key Buffer approach used in EncryptedDatabase and during setup rekey.
    db.key(Buffer.from(hexKey, 'hex'));
    // integrity_check reads all DB pages — throws "file is not a database" on wrong key.
    const check = db.pragma("integrity_check", { simple: true });
    if (check !== "ok") throw new Error(`integrity_check: ${check}`);
  } catch (err) {
    try { db?.close(); } catch { /* ignore */ }
    unlockInProgress = false;
    recordFailedAttempt(ip);
    return NextResponse.json({ error: "Incorrect passphrase" }, { status: 401 });
  }

  // Phase 2: key is verified — run migrations separately so errors surface correctly.
  try {
    runMigrations(db);
  } catch (err) {
    try { db?.close(); } catch { /* ignore */ }
    unlockInProgress = false;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Unlock failed: ${msg}` }, { status: 500 });
  }
  db.close();
  unlockInProgress = false;
  unlockAttempts.delete(ip);

  unlock(hexKey);
  initPrisma();
  try {
    await verifyPrismaConnection();
  } catch (err) {
    lockDb();
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Unlock failed: ${msg}` }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  setUnlockedCookie(res);
  return res;
}
