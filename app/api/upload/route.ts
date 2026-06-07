import { NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const QUOTA_BYTES = parseInt(process.env.UPLOAD_QUOTA_BYTES ?? "") || 500 * 1024 * 1024; // 500 MB default

function detectMimeFromMagic(buf: Buffer): { mime: string; ext: string } | null {
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: "image/png", ext: "png" };
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { mime: "image/gif", ext: "gif" };
  // WebP: RIFF????WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return { mime: "image/webp", ext: "webp" };
  return null;
}

async function cleanOrphanedUploads(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000); // older than 1 hour
  const candidates = await prisma.upload.findMany({
    where: { userId, createdAt: { lt: cutoff } },
  });
  if (candidates.length === 0) return;

  const uploadDir = join(process.cwd(), "data", "uploads");
  for (const upload of candidates) {
    const ref = `/api/uploads/${upload.filename}`;
    const inNote = await prisma.note.count({ where: { userId, content: { contains: ref } } });
    if (inNote > 0) continue;
    const inTask = await prisma.task.count({ where: { project: { userId }, description: { contains: ref } } });
    if (inTask > 0) continue;
    // Not referenced anywhere — delete
    await prisma.upload.delete({ where: { id: upload.id } }).catch(() => {});
    await unlink(join(uploadDir, upload.filename)).catch(() => {});
  }
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!await checkRateLimit(`upload:${userId}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Upload rate limit exceeded. Try again later." }, { status: 429 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Re-check size against the actual buffer — the earlier check used the multipart header
  // which is user-controlled and can be spoofed to bypass the limit
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
  }

  const detected = detectMimeFromMagic(buffer);
  if (!detected) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, GIF, and WebP images are allowed" },
      { status: 415 }
    );
  }

  // Check per-user storage quota (exclude soft-deleted uploads)
  const usage = await prisma.upload.aggregate({ where: { userId, deletedAt: null }, _sum: { size: true } });
  const currentBytes = usage._sum.size ?? 0;
  if (currentBytes + buffer.length > QUOTA_BYTES) {
    return NextResponse.json({ error: "Storage quota exceeded" }, { status: 413 });
  }

  const uploadDir = join(process.cwd(), "data", "uploads");
  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true });
  }

  const filename = `${randomBytes(16).toString("hex")}.${detected.ext}`;
  await writeFile(join(uploadDir, filename), buffer);

  await prisma.upload.create({ data: { filename, mimeType: detected.mime, size: buffer.length, userId } });

  // Background cleanup of orphaned uploads — must not block the response
  cleanOrphanedUploads(userId).catch(() => {});

  return NextResponse.json({ url: `/api/uploads/${filename}` });
}
