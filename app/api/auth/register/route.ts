import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { getClientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { MAX_USERNAME_LEN, MAX_PASSWORD_LEN } from "@/lib/constants";

function generateRecoveryCode(): string {
  const hex = randomBytes(18).toString("hex").toUpperCase();
  return `${hex.slice(0, 6)}-${hex.slice(6, 12)}-${hex.slice(12, 18)}-${hex.slice(18, 24)}`;
}

// In-memory rate limiter — avoids the first Prisma write on registration,
// which would acquire the adapter's transaction mutex. A Prisma write failure
// during that acquisition would deadlock all subsequent writes in the same
// process because the mutex never releases.
const registerAttempts = new Map<string, { count: number; firstAt: number }>();
const RATE_LIMIT     = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function isRegisterRateLimited(ip: string): boolean {
  const entry = registerAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAt > RATE_WINDOW_MS) return false;
  return entry.count >= RATE_LIMIT;
}

function recordRegisterAttempt(ip: string): void {
  const now   = Date.now();
  const entry = registerAttempts.get(ip);
  if (!entry || now - entry.firstAt > RATE_WINDOW_MS) {
    registerAttempts.set(ip, { count: 1, firstAt: now });
  } else {
    entry.count++;
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (isRegisterRateLimited(ip)) {
    return NextResponse.json({ error: "Too many registration attempts. Try again later." }, { status: 429 });
  }
  recordRegisterAttempt(ip);

  const body = await request.json().catch(() => null);
  const { username, password } = body ?? {};

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  if (username.length < 3) {
    return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
  }
  if (username.length > MAX_USERNAME_LEN) {
    return NextResponse.json({ error: `Username must be at most ${MAX_USERNAME_LEN} characters` }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return NextResponse.json({ error: "Username may only contain letters, numbers, _ and -" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: "Password is too long" }, { status: 400 });
  }

  try {
    const normalized = username.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { username: normalized } });
    if (existing) {
      return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
    }

    const recoveryCode = generateRecoveryCode();
    const [passwordHash, recoveryCodeHash] = await Promise.all([
      bcrypt.hash(password, 10),
      bcrypt.hash(recoveryCode, 10),
    ]);

    const user = await prisma.user.create({
      data: { username: normalized, passwordHash, recoveryCodeHash },
    });

    audit("register", { userId: user.id, ip });

    return NextResponse.json({ id: user.id, username: user.username, recoveryCode }, { status: 201 });
  } catch (err) {
    console.error("[register] error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Registration failed: ${msg}` }, { status: 500 });
  }
}
