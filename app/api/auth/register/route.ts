import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { MAX_USERNAME_LEN, MAX_PASSWORD_LEN } from "@/lib/constants";

function generateRecoveryCode(): string {
  const hex = randomBytes(18).toString("hex").toUpperCase();
  return `${hex.slice(0, 6)}-${hex.slice(6, 12)}-${hex.slice(12, 18)}-${hex.slice(18, 24)}`;
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!await checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000)) {
    audit("rate_limit_exceeded", { ip, detail: "register" });
    return NextResponse.json({ error: "Too many registration attempts. Try again later." }, { status: 429 });
  }

  const { username, password } = await request.json();

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

  const normalized = username.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { username: normalized } });
  if (existing) {
    return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
  }

  const recoveryCode = generateRecoveryCode();
  const [passwordHash, recoveryCodeHash] = await Promise.all([
    bcrypt.hash(password, 12),
    bcrypt.hash(recoveryCode, 12),
  ]);

  const user = await prisma.user.create({
    data: { username: normalized, passwordHash, recoveryCodeHash },
  });

  audit("register", { userId: user.id, ip });

  // Return the plaintext recovery code exactly once — never stored in plaintext
  return NextResponse.json({ id: user.id, username: user.username, recoveryCode }, { status: 201 });
}
