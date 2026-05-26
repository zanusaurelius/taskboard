import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { issueRevealToken, revokeRevealToken } from "@/lib/vault-session";

// POST — client proved it has the correct master key (via verifier), issue a reveal token
export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.verifier) return NextResponse.json({ error: "Missing verifier" }, { status: 400 });

  const vault = await prisma.noteVault.findUnique({ where: { userId } });
  if (!vault) return NextResponse.json({ error: "No vault configured" }, { status: 404 });

  // Constant-time comparison to prevent timing attacks
  const { createHash, timingSafeEqual } = await import("crypto");
  const stored  = Buffer.from(vault.verifier, "base64");
  const provided = Buffer.from(body.verifier, "base64");
  const match = stored.length === provided.length && timingSafeEqual(stored, provided);

  if (!match) return NextResponse.json({ error: "Incorrect vault password" }, { status: 401 });

  const token = issueRevealToken(userId);
  return NextResponse.json({ token });
}

// DELETE — revoke the active reveal token (auto-hide)
export async function DELETE(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  revokeRevealToken(userId);
  return new NextResponse(null, { status: 204 });
}
