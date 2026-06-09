export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encode } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const COOKIE_NAME = "authjs.session-token";
const ANON_TTL_MS = 48 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/";

  const username = `anon_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(32).toString("hex");

  const [passwordHash, recoveryCodeHash] = await Promise.all([
    bcrypt.hash(password, 10),
    bcrypt.hash(randomBytes(18).toString("hex"), 10),
  ]);

  const anonymousExpiresAt = new Date(Date.now() + ANON_TTL_MS);

  const user = await prisma.user.create({
    data: { username, passwordHash, recoveryCodeHash, isAnonymous: true, anonymousExpiresAt },
  });

  const token = await encode({
    token: {
      id: user.id,
      username: user.username,
      issuedAt: Date.now(),
      passwordChangedAt: user.passwordChangedAt.getTime(),
    },
    secret: process.env.AUTH_SECRET!,
    salt: COOKIE_NAME,
    maxAge: ANON_TTL_MS / 1000,
  });

  const safeNext = next.startsWith("/") ? next : "/";
  const response = NextResponse.redirect(new URL(safeNext, req.url));
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: ANON_TTL_MS / 1000,
  });
  return response;
}
