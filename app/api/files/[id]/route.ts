import { NextResponse } from "next/server";
import { unlink, stat } from "fs/promises";
import { existsSync, createReadStream } from "fs";
import { Readable } from "stream";
import { join, basename } from "path";
import { getUserId, getUserIdWithQueryToken } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { UPLOAD_DIR, THUMB_DIR } from "@/lib/file-utils";

const INLINE_MIMES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
  "video/mp4", "video/quicktime",
  "audio/mpeg", "audio/mp4",
  "text/plain", "text/markdown",
]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdWithQueryToken(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await prisma.upload.findFirst({ where: { id, userId, deletedAt: null } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = join(UPLOAD_DIR, upload.filename);
  if (!existsSync(filePath)) return NextResponse.json({ error: "File not found on disk" }, { status: 404 });

  // Use stat for accurate size (DB value can be stale if file was replaced)
  const { size: diskSize } = await stat(filePath).catch(() => ({ size: upload.size }));

  const safeName = encodeURIComponent(upload.originalName ?? "file");
  const disposition = INLINE_MIMES.has(upload.mimeType)
    ? `inline; filename*=UTF-8''${safeName}`
    : `attachment; filename*=UTF-8''${safeName}`;

  const sharedHeaders = {
    "Content-Type": upload.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };

  // Handle HTTP Range requests so video/audio can seek in browser players
  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : diskSize - 1;
      const clampedEnd = Math.min(end, diskSize - 1);
      if (start < 0 || start > clampedEnd) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${diskSize}` },
        });
      }
      const chunkSize = clampedEnd - start + 1;
      const stream = Readable.toWeb(createReadStream(filePath, { start, end: clampedEnd })) as ReadableStream;
      return new Response(stream, {
        status: 206,
        headers: {
          ...sharedHeaders,
          "Content-Range": `bytes ${start}-${clampedEnd}/${diskSize}`,
          "Content-Length": String(chunkSize),
        },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(stream, {
    headers: {
      ...sharedHeaders,
      "Content-Disposition": disposition,
      "Content-Length": String(diskSize),
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
  const { folderId: rawFolderId, originalName } = body as { folderId?: string | null; originalName?: string };

  // Normalize empty string to null (empty string is not a valid CUID)
  const folderId = rawFolderId === "" ? null : rawFolderId;

  if (originalName !== undefined) {
    if (!originalName.trim()) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    if (originalName.trim().length > 255) return NextResponse.json({ error: "Name too long" }, { status: 400 });
  }

  // Verify destination folder belongs to user
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

  // Clean up the original file and its thumbnail (if one was generated)
  await unlink(join(UPLOAD_DIR, upload.filename)).catch(() => {});
  if (upload.thumbnail) {
    await unlink(join(THUMB_DIR, basename(upload.thumbnail))).catch(() => {});
  }

  return new Response(null, { status: 204 });
}
