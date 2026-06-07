import { NextResponse } from "next/server";
import { writeFile, unlink, rename } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { detectFileType, ensureFileDirs, UPLOAD_DIR } from "@/lib/file-utils";

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB per file
const QUOTA_BYTES = parseInt(process.env.FILE_QUOTA_BYTES ?? "", 10) || 10 * 1024 * 1024 * 1024; // 10 GB
const LIST_LIMIT = 500; // max files returned per folder listing

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId"); // null = root, "none" = also root
  const all = searchParams.get("all") === "true"; // skip folder filter (used by search)

  const files = await prisma.upload.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(all ? {} : { fileFolderId: folderId && folderId !== "none" ? folderId : null }),
      // Never expose files that are exclusively attached to vault (hidden) notes
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

  // Read into memory. request.formData() already buffered the entire body (Next.js proxy
  // middleware clones it), so arrayBuffer() is just accessing that in-memory data —
  // no extra heap cost compared to the previous file.stream() approach.
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

  // Verify folder belongs to user
  if (folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: folderId, userId } });
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
  }

  // Quota check (against all non-deleted uploads)
  const usage = await prisma.upload.aggregate({ where: { userId, deletedAt: null }, _sum: { size: true } });
  const totalBytes = usage._sum.size ?? 0;
  if (totalBytes + buffer.length > QUOTA_BYTES) {
    return NextResponse.json({ error: "Storage quota exceeded" }, { status: 413 });
  }

  await ensureFileDirs();

  // Find a unique filename (3 attempts)
  let filename: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${randomBytes(16).toString("hex")}.${detected.ext}`;
    const existing = await prisma.upload.findUnique({ where: { filename: candidate } });
    if (!existing) { filename = candidate; break; }
  }
  if (!filename) {
    return NextResponse.json({ error: "Upload failed (filename conflict)" }, { status: 500 });
  }

  // Write to a temp file then atomically rename — no partial-write window
  const tmpFilename = `tmp_${randomBytes(8).toString("hex")}`;
  const tmpPath = join(UPLOAD_DIR, tmpFilename);
  const finalPath = join(UPLOAD_DIR, filename);

  try {
    await writeFile(tmpPath, buffer);
    await rename(tmpPath, finalPath);
  } catch {
    await unlink(tmpPath).catch(() => {});
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  let upload;
  try {
    upload = await prisma.upload.create({
      data: {
        filename,
        originalName: file.name,
        mimeType: detected.mime,
        size: buffer.length,
        userId,
        fileFolderId: folderId,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        thumbnail: true,
        fileFolderId: true,
        createdAt: true,
        updatedAt: true,
        attachments: { select: { noteId: true, taskId: true } },
      },
    });
  } catch {
    await unlink(finalPath).catch(() => {});
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  return NextResponse.json(upload, { status: 201 });
}
