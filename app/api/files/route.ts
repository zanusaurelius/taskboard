export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomBytes } from "crypto";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { detectFileType } from "@/lib/file-utils";

const MAX_BYTES = 500 * 1024 * 1024;
const QUOTA_BYTES = parseInt(process.env.FILE_QUOTA_BYTES ?? "", 10) || 10 * 1024 * 1024 * 1024;
const LIST_LIMIT = 500;

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");
  const all = searchParams.get("all") === "true";

  const files = await prisma.upload.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(all ? {} : { fileFolderId: folderId && folderId !== "none" ? folderId : null }),
      NOT: { attachments: { some: { note: { hidden: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      thumbnail: true,
      blobUrl: true,
      fileFolderId: true,
      createdAt: true,
      updatedAt: true,
      attachments: { select: { noteId: true, taskId: true } },
    },
  });

  return NextResponse.json(files);
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!await checkRateLimit(`files:${userId}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formData = await request.formData() as any;
  const file = formData.get("file") as File | null;
  const folderId = (formData.get("folderId") as string | null) || null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds 500 MB limit" }, { status: 413 });

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Failed to read uploaded file" }, { status: 500 });
  }

  if (buffer.length === 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: "File exceeds 500 MB limit" }, { status: 413 });

  const detected = detectFileType(buffer.slice(0, 512), file.name);
  if (!detected) {
    return NextResponse.json(
      { error: "File type not supported. Allowed: images, video (MP4/MOV), audio (MP3/M4A), PDF, Office docs, text, zip." },
      { status: 415 },
    );
  }

  if (folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: folderId, userId } });
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
  }

  const usage = await prisma.upload.aggregate({ where: { userId, deletedAt: null }, _sum: { size: true } });
  const totalBytes = usage._sum.size ?? 0;
  if (totalBytes + buffer.length > QUOTA_BYTES) {
    return NextResponse.json({ error: "Storage quota exceeded" }, { status: 413 });
  }

  const filename = `${randomBytes(16).toString("hex")}.${detected.ext}`;
  const blob = await put(`files/${filename}`, buffer, { access: "public", contentType: detected.mime });

  const created = await prisma.upload.create({
    data: {
      filename,
      originalName: file.name,
      mimeType: detected.mime,
      size: buffer.length,
      userId,
      fileFolderId: folderId,
      blobUrl: blob.url,
    },
  });

  // Neon HTTP: create+select with relation uses implicit transaction — fetch separately
  const upload = await prisma.upload.findUnique({
    where: { id: created.id },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      thumbnail: true,
      blobUrl: true,
      fileFolderId: true,
      createdAt: true,
      updatedAt: true,
      attachments: { select: { noteId: true, taskId: true } },
    },
  });

  return NextResponse.json(upload, { status: 201 });
}
