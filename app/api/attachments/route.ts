export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomBytes } from "crypto";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { detectFileType } from "@/lib/file-utils";

const MAX_BYTES = 50 * 1024 * 1024;
const QUOTA_BYTES = parseInt(process.env.UPLOAD_QUOTA_BYTES ?? "") || 500 * 1024 * 1024;

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const noteId = searchParams.get("noteId");
  const taskId = searchParams.get("taskId");

  if (!noteId && !taskId) return NextResponse.json({ error: "noteId or taskId required" }, { status: 400 });

  if (noteId) {
    const note = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null } });
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, project: { userId } } });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const attachments = await prisma.attachment.findMany({
    where: {
      ...(noteId ? { noteId, userId } : { taskId, userId }),
      OR: [{ uploadId: null }, { upload: { deletedAt: null } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadId: true, blobUrl: true },
  });

  return NextResponse.json(attachments);
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!await checkRateLimit(`attach:${userId}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  // ── JSON path: link an existing Upload as an Attachment ──────────────────────
  if (contentType.includes("application/json")) {
    const body = await request.json() as { uploadId?: string; noteId?: string; taskId?: string };
    const { uploadId, noteId, taskId } = body;

    if (!uploadId) return NextResponse.json({ error: "uploadId is required" }, { status: 400 });
    if (!noteId && !taskId) return NextResponse.json({ error: "noteId or taskId is required" }, { status: 400 });

    const upload = await prisma.upload.findFirst({ where: { id: uploadId, userId, deletedAt: null } });
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    if (noteId) {
      const note = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null } });
      if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    if (taskId) {
      const task = await prisma.task.findFirst({ where: { id: taskId, project: { userId } } });
      if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const linkFilename = `link:${randomBytes(16).toString("hex")}`;

    const attachment = await prisma.attachment.create({
      data: {
        filename: linkFilename,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        size: upload.size,
        userId,
        noteId: noteId ?? undefined,
        taskId: taskId ?? undefined,
        uploadId,
        blobUrl: upload.blobUrl,
      },
      select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadId: true, blobUrl: true },
    });

    return NextResponse.json(attachment, { status: 201 });
  }

  // ── FormData path: upload a new file ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formData = await request.formData() as any;
  const file = formData.get("file") as File | null;
  const noteId = formData.get("noteId") as string | null;
  const taskId = formData.get("taskId") as string | null;

  if (!noteId && !taskId) return NextResponse.json({ error: "noteId or taskId is required" }, { status: 400 });
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });

  const detected = detectFileType(buffer, file.name);
  if (!detected) {
    return NextResponse.json(
      { error: "File type not supported. Allowed: images, PDF, Office docs, text, and zip." },
      { status: 415 },
    );
  }

  if (noteId) {
    const note = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null } });
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, project: { userId } } });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [uploadUsage, attachUsage] = await Promise.all([
    prisma.upload.aggregate({ where: { userId, deletedAt: null }, _sum: { size: true } }),
    prisma.attachment.aggregate({ where: { userId }, _sum: { size: true } }),
  ]);
  const totalBytes = (uploadUsage._sum.size ?? 0) + (attachUsage._sum.size ?? 0);
  if (totalBytes + buffer.length > QUOTA_BYTES) {
    return NextResponse.json({ error: "Storage quota exceeded" }, { status: 413 });
  }

  const filename = `${randomBytes(16).toString("hex")}.${detected.ext}`;
  const blob = await put(`attachments/${filename}`, buffer, { access: "public", contentType: detected.mime });

  const attachment = await prisma.attachment.create({
    data: {
      filename,
      originalName: file.name,
      mimeType: detected.mime,
      size: buffer.length,
      userId,
      noteId: noteId ?? undefined,
      taskId: taskId ?? undefined,
      blobUrl: blob.url,
    },
    select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadId: true, blobUrl: true },
  });

  return NextResponse.json(attachment, { status: 201 });
}
