import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { MAX_PASSWORD_LEN } from "@/lib/constants";

// Valid 60-char bcrypt hash used for constant-time dummy compare when username not found.
// Must be exactly 60 chars — bcryptjs bails early (no computation) on wrong-length hashes,
// which would defeat the timing equalisation and re-expose username enumeration.
const DUMMY_HASH = "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/lewdummyhashxxxxx";

function generateRecoveryCode(): string {
  const hex = randomBytes(18).toString("hex").toUpperCase();
  return `${hex.slice(0, 6)}-${hex.slice(6, 12)}-${hex.slice(12, 18)}-${hex.slice(18, 24)}`;
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!await checkRateLimit(`recover:${ip}`, 5, 15 * 60 * 1000)) {
    audit("rate_limit_exceeded", { ip, detail: "recover" });
    return NextResponse.json({ error: "Too many recovery attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const { username, recoveryCode, newPassword } = body ?? {};

  if (!username || !recoveryCode || !newPassword) {
    return NextResponse.json({ error: "Username, recovery code, and new password are required" }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (newPassword.length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: "Password is too long" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase().trim() },
  });
  // Same error whether user not found or code wrong — prevents username enumeration
  const invalid = NextResponse.json({ error: "Invalid username or recovery code" }, { status: 401 });

  const normalized = recoveryCode.trim().toUpperCase();

  if (!user) {
    // Constant-time dummy compare to prevent username enumeration via response timing
    await bcrypt.compare(normalized, DUMMY_HASH);
    audit("recover_failure", { ip, detail: username });
    return invalid;
  }

  const valid = await bcrypt.compare(normalized, user.recoveryCodeHash);
  if (!valid) {
    audit("recover_failure", { ip, detail: username });
    return invalid;
  }

  // Generate a fresh recovery code so the old one can never be reused
  const newRecoveryCode = generateRecoveryCode();
  const [passwordHash, recoveryCodeHash] = await Promise.all([
    bcrypt.hash(newPassword, 12),
    bcrypt.hash(newRecoveryCode, 12),
  ]);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, recoveryCodeHash, passwordChangedAt: new Date() },
  });

  audit("recover_success", { userId: user.id, ip });

  return NextResponse.json({ ok: true, newRecoveryCode });
}
