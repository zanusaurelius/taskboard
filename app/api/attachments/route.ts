import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file
const QUOTA_BYTES = parseInt(process.env.UPLOAD_QUOTA_BYTES ?? "") || 500 * 1024 * 1024;

const ALLOWED: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  pdf:  { mime: "application/pdf",                                                                      magic: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",             magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",                   magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",           magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  odt:  { mime: "application/vnd.oasis.opendocument.text",                                             magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  ods:  { mime: "application/vnd.oasis.opendocument.spreadsheet",                                      magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  jpg:  { mime: "image/jpeg",                                                                           magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png:  { mime: "image/png",                                                                            magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  gif:  { mime: "image/gif",                                                                            magic: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  webp: { mime: "image/webp",                                                                           magic: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
};

function detectType(buf: Buffer, originalName: string): { mime: string; ext: string } | null {
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
  const allowed = ALLOWED[ext];
  if (!allowed) return null;
  if (!allowed.magic(buf)) return null;
  return { mime: allowed.mime, ext };
}

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const noteId = searchParams.get("noteId");
  const taskId = searchParams.get("taskId");

  if (!noteId && !taskId) return NextResponse.json({ error: "noteId or taskId required" }, { status: 400 });

  // Verify ownership — also check note is not trashed
  if (noteId) {
    const note = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null } });
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, project: { userId } } });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const attachments = await prisma.attachment.findMany({
    where: noteId ? { noteId, userId } : { taskId, userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true },
  });

  return NextResponse.json(attachments);
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!await checkRateLimit(`attach:${userId}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formData = await request.formData() as any;
  const file = formData.get("file") as File | null;
  const noteId = formData.get("noteId") as string | null;
  const taskId = formData.get("taskId") as string | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!noteId && !taskId) return NextResponse.json({ error: "noteId or taskId required" }, { status: 400 });

  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });

  const detected = detectType(buffer, file.name);
  if (!detected) {
    return NextResponse.json(
      { error: "File type not supported. Allowed: PDF, DOCX, XLSX, PPTX, ODT, ODS, and images." },
      { status: 415 },
    );
  }

  // Verify ownership — also check note is not trashed
  if (noteId) {
    const note = await prisma.note.findFirst({ where: { id: noteId, userId, deletedAt: null } });
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, project: { userId } } });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Quota check (uploads + attachments combined)
  const [uploadUsage, attachUsage] = await Promise.all([
    prisma.upload.aggregate({ where: { userId }, _sum: { size: true } }),
    prisma.attachment.aggregate({ where: { userId }, _sum: { size: true } }),
  ]);
  const totalBytes = (uploadUsage._sum.size ?? 0) + (attachUsage._sum.size ?? 0);
  if (totalBytes + buffer.length > QUOTA_BYTES) {
    return NextResponse.json({ error: "Storage quota exceeded" }, { status: 413 });
  }

  const uploadDir = join(process.cwd(), "data", "uploads");
  if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true });

  // Retry on filename collision (astronomically rare but @@unique would throw)
  let filename: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${randomBytes(16).toString("hex")}.${detected.ext}`;
    const existing = await prisma.attachment.findUnique({ where: { filename: candidate } });
    if (!existing) { filename = candidate; break; }
  }
  if (!filename) return NextResponse.json({ error: "Upload failed (filename conflict)" }, { status: 500 });

  await writeFile(join(uploadDir, filename), buffer);

  const attachment = await prisma.attachment.create({
    data: {
      filename,
      originalName: file.name,
      mimeType: detected.mime,
      size: buffer.length,
      userId,
      noteId: noteId ?? undefined,
      taskId: taskId ?? undefined,
    },
    select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true },
  });

  return NextResponse.json(attachment, { status: 201 });
}
