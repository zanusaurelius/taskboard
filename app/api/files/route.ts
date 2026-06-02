import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { detectFileType, ensureFileDirs, UPLOAD_DIR } from "@/lib/file-utils";

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB per file
const QUOTA_BYTES = parseInt(process.env.FILE_QUOTA_BYTES ?? "") || 10 * 1024 * 1024 * 1024; // 10 GB

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId"); // null = root, "none" = also root

  const files = await prisma.upload.findMany({
    where: {
      userId,
      fileFolderId: folderId && folderId !== "none" ? folderId : null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      thumbnail: true,
      fileFolderId: true,
      createdAt: true,
      updatedAt: true,
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

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: "File exceeds 500 MB limit" }, { status: 413 });

  const detected = detectFileType(buffer, file.name);
  if (!detected) {
    return NextResponse.json(
      { error: "File type not supported. Allowed: images, video (MP4/MOV), audio (MP3/M4A), PDF, Office docs, text, zip." },
      { status: 415 },
    );
  }

  // Verify folder belongs to user
  if (folderId) {
    const folder = await prisma.fileFolder.findFirst({ where: { id: folderId, userId } });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // Quota check (uploads only)
  const usage = await prisma.upload.aggregate({ where: { userId }, _sum: { size: true } });
  const totalBytes = usage._sum.size ?? 0;
  if (totalBytes + buffer.length > QUOTA_BYTES) {
    return NextResponse.json({ error: "Storage quota exceeded" }, { status: 413 });
  }

  await ensureFileDirs();

  let filename: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${randomBytes(16).toString("hex")}.${detected.ext}`;
    const existing = await prisma.upload.findUnique({ where: { filename: candidate } });
    if (!existing) { filename = candidate; break; }
  }
  if (!filename) return NextResponse.json({ error: "Upload failed (filename conflict)" }, { status: 500 });

  await writeFile(join(UPLOAD_DIR, filename), buffer);

  const upload = await prisma.upload.create({
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
    },
  });

  return NextResponse.json(upload, { status: 201 });
}
