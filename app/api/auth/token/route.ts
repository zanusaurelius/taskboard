import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { issueApiToken } from "@/lib/api-token";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { MAX_USERNAME_LEN, MAX_PASSWORD_LEN } from "@/lib/constants";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!await checkRateLimit(`api-token:${ip}`, 10, 15 * 60 * 1000)) {
    audit("rate_limit_exceeded", { ip, detail: "api-token" });
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }
  if (String(username).length > MAX_USERNAME_LEN || String(password).length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { username: String(username).toLowerCase().trim() },
  });
  if (!user) {
    audit("login_failure", { ip, detail: String(username) });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await bcrypt.compare(String(password), user.passwordHash);
  if (!valid) {
    audit("login_failure", { ip, detail: String(username) });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await issueApiToken(user.id);
  audit("api_token_issued", { userId: user.id, ip });

  return NextResponse.json({ token, userId: user.id });
}
