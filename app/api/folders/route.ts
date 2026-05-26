import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { verifyRevealToken } from "@/lib/vault-session";
import { MAX_FOLDER_NAME_LEN } from "@/lib/constants";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const revealToken = request.headers.get("x-reveal-token") ?? "";
  const revealed = revealToken ? verifyRevealToken(userId, revealToken) : false;

  const folders = await prisma.folder.findMany({
    where: { userId, ...(!revealed ? { hidden: false } : {}) },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(folders);
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { name, encName } = body ?? {};
  if (!name?.trim() && !encName) return NextResponse.json({ error: "name or encName is required" }, { status: 400 });
  if (name?.trim() && name.trim().length > MAX_FOLDER_NAME_LEN) {
    return NextResponse.json({ error: `Name must be at most ${MAX_FOLDER_NAME_LEN} characters` }, { status: 400 });
  }
  const folder = await prisma.folder.create({
    data: { name: name?.trim() ?? "", ...(encName !== undefined && { encName }), userId },
  });
  return NextResponse.json(folder, { status: 201 });
}
