export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { getUserId, getUserIdWithQueryToken } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdWithQueryToken(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await prisma.upload.findFirst({ where: { id, userId, deletedAt: null } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (upload.blobUrl) {
    return NextResponse.redirect(upload.blobUrl);
  }

  return NextResponse.json({ error: "File not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await prisma.upload.findFirst({ where: { id, userId } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { folderId: rawFolderId, originalName } = body as { folderId?: string | null; originalName?: string };

  const folderId = rawFolderId === "" ? null : rawFolderId;

  if (originalName !== undefined) {
    if (!originalName.trim()) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    if (originalName.trim().length > 255) return NextResponse.json({ error: "Name too long" }, { status: 400 });
  }

  if (folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const updated = await prisma.upload.update({
    where: { id },
    data: {
      ...(folderId !== undefined ? { fileFolderId: folderId } : {}),
      ...(originalName !== undefined ? { originalName: originalName.trim() } : {}),
    },
    select: { id: true, originalName: true, mimeType: true, size: true, thumbnail: true, blobUrl: true, fileFolderId: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await prisma.upload.findFirst({ where: { id, userId } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.upload.delete({ where: { id } });

  if (upload.blobUrl) del(upload.blobUrl).catch(() => {});

  return new Response(null, { status: 204 });
}
