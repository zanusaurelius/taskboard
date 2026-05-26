import crypto from "crypto";

// Server-side in-memory stores. Single-process SQLite deployment — no external cache needed.

interface TimedEntry { value: string; expiresAt: number }

const revealTokens   = new Map<string, TimedEntry>(); // userId → token
const webAuthnChallenges = new Map<string, TimedEntry>(); // userId → challenge

const REVEAL_TTL  = 10 * 60 * 1000; // 10 min
const CHALLENGE_TTL = 5 * 60 * 1000; // 5 min

function prune(map: Map<string, TimedEntry>) {
  const now = Date.now();
  for (const [k, v] of map) if (v.expiresAt < now) map.delete(k);
}

// ── Reveal tokens ─────────────────────────────────────────────────────────────

export function issueRevealToken(userId: string): string {
  prune(revealTokens);
  const token = crypto.randomBytes(32).toString("hex");
  revealTokens.set(userId, { value: token, expiresAt: Date.now() + REVEAL_TTL });
  return token;
}

export function verifyRevealToken(userId: string, token: string): boolean {
  prune(revealTokens);
  const entry = revealTokens.get(userId);
  if (!entry || entry.expiresAt < Date.now()) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(entry.value, "hex"), Buffer.from(token, "hex"));
  } catch {
    return false;
  }
}

export function revokeRevealToken(userId: string): void {
  revealTokens.delete(userId);
}

// ── WebAuthn challenges ───────────────────────────────────────────────────────

export function storeWebAuthnChallenge(userId: string, challenge: string): void {
  prune(webAuthnChallenges);
  webAuthnChallenges.set(userId, { value: challenge, expiresAt: Date.now() + CHALLENGE_TTL });
}

export function consumeWebAuthnChallenge(userId: string): string | null {
  const entry = webAuthnChallenges.get(userId);
  webAuthnChallenges.delete(userId);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value;
}
