import { NextResponse } from "next/server";
import { unlink, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getUserId, getUserIdWithQueryToken } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { UPLOAD_DIR } from "@/lib/file-utils";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdWithQueryToken(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const attachment = await prisma.attachment.findFirst({ where: { id, userId } });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = join(UPLOAD_DIR, attachment.filename);
  if (!existsSync(filePath)) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const buffer = await readFile(filePath);

  const inlineMimes = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "video/mp4", "video/quicktime", "audio/mpeg", "audio/mp4", "text/plain", "text/markdown"];
  const safeName = encodeURIComponent(attachment.originalName ?? "file");
  const disposition = inlineMimes.includes(attachment.mimeType)
    ? `inline; filename*=UTF-8''${safeName}`
    : `attachment; filename*=UTF-8''${safeName}`;

  return new Response(buffer, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": disposition,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const attachment = await prisma.attachment.findFirst({ where: { id, userId } });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.attachment.delete({ where: { id } });

  const filePath = join(UPLOAD_DIR, attachment.filename);
  await unlink(filePath).catch(() => {});

  return new Response(null, { status: 204 });
}
