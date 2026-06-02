import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { UPLOAD_DIR, THUMB_DIR, isImage } from "@/lib/file-utils";

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

  // If a pre-generated thumbnail exists, serve it
  if (upload.thumbnail) {
    const thumbPath = join(THUMB_DIR, upload.thumbnail);
    if (existsSync(thumbPath)) {
      const buffer = await readFile(thumbPath);
      return new Response(buffer, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=86400",
        },
      });
    }
  }

  // For images, serve the original file as the thumbnail (browser scales via CSS)
  if (isImage(upload.mimeType)) {
    const filePath = join(UPLOAD_DIR, upload.filename);
    if (!existsSync(filePath)) return NextResponse.json({ error: "File not found" }, { status: 404 });
    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": upload.mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  // Non-image files have no visual thumbnail
  return NextResponse.json({ error: "No thumbnail available" }, { status: 404 });
}
