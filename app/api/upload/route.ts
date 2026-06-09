export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { randomBytes } from "crypto";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";

const MAX_BYTES = 10 * 1024 * 1024;

function detectMimeFromMagic(buf: Buffer): { mime: string; ext: string } | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { mime: "image/gif", ext: "gif" };
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return { mime: "image/webp", ext: "webp" };
  return null;
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

  const filename = `${randomBytes(16).toString("hex")}.${detected.ext}`;
  const blob = await put(`uploads/${filename}`, buffer, { access: "public", contentType: detected.mime });

  await prisma.upload.create({
    data: { filename, mimeType: detected.mime, size: buffer.length, userId, blobUrl: blob.url },
  });

  return NextResponse.json({ url: blob.url });
}
