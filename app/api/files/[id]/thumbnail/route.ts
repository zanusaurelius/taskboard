import { NextResponse } from "next/server";
import { existsSync, createReadStream } from "fs";
import { Readable } from "stream";
import { join, basename } from "path";
import { getUserIdWithQueryToken } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";
import { UPLOAD_DIR, THUMB_DIR, isImage } from "@/lib/file-utils";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdWithQueryToken(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await prisma.upload.findFirst({ where: { id, userId } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If a pre-generated thumbnail exists, serve it
  if (upload.thumbnail) {
    const thumbPath = join(THUMB_DIR, basename(upload.thumbnail)); // basename prevents path traversal
    if (existsSync(thumbPath)) {
      const stream = Readable.toWeb(createReadStream(thumbPath)) as ReadableStream;
      return new Response(stream, {
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
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": upload.mimeType,
        "Content-Length": String(upload.size),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  // Non-image files have no visual thumbnail
  return NextResponse.json({ error: "No thumbnail available" }, { status: 404 });
}
