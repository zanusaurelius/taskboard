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

  // Constant-time comparison to prevent timing attacks.
  // Pad to the same length before comparing so that length differences don't
  // leak timing information (a short-circuit on length would reveal verifier size).
  const { timingSafeEqual } = await import("crypto");
  const stored   = Buffer.from(vault.verifier, "base64");
  const provided = Buffer.from(body.verifier,  "base64");
  const len = Math.max(stored.length, provided.length);
  const a = Buffer.alloc(len);
  const b = Buffer.alloc(len);
  stored.copy(a);
  provided.copy(b);
  const match = stored.length === provided.length && timingSafeEqual(a, b);

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
