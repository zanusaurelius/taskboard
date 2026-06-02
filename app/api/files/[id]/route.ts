import { NextResponse } from "next/server";
import { unlink, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { UPLOAD_DIR } from "@/lib/file-utils";

async function getUserIdWithQueryToken(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    const fakeReq = new Request(request.url, {
      headers: { Authorization: `Bearer ${queryToken}` },
    });
    return getUserId(fakeReq);
  }
  return getUserId(request);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdWithQueryToken(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await prisma.upload.findFirst({ where: { id, userId } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = join(UPLOAD_DIR, upload.filename);
  if (!existsSync(filePath)) return NextResponse.json({ error: "File not found on disk" }, { status: 404 });

  const buffer = await readFile(filePath);

  const inlineMimes = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "video/mp4", "video/quicktime", "audio/mpeg", "audio/mp4", "text/plain", "text/markdown"];
  const disposition = inlineMimes.includes(upload.mimeType)
    ? `inline; filename="${upload.originalName}"`
    : `attachment; filename="${upload.originalName}"`;

  return new Response(buffer, {
    headers: {
      "Content-Type": upload.mimeType,
      "Content-Disposition": disposition,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await prisma.upload.findFirst({ where: { id, userId } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { folderId } = body as { folderId?: string | null };

  // Verify destination folder belongs to user
  if (folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const updated = await prisma.upload.update({
    where: { id },
    data: { fileFolderId: folderId ?? null },
    select: { id: true, originalName: true, mimeType: true, size: true, thumbnail: true, fileFolderId: true, createdAt: true, updatedAt: true },
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

  const filePath = join(UPLOAD_DIR, upload.filename);
  await unlink(filePath).catch(() => {});

  return new Response(null, { status: 204 });
}
