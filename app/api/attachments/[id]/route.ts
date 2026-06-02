import { NextResponse } from "next/server";
import { unlink, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

// Serve the file inline (PDF, images) or as a download (Office docs)
async function getUserIdWithQueryToken(request: Request): Promise<string | null> {
  // Allow ?token= query param so mobile can open files via Linking.openURL
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
  const attachment = await prisma.attachment.findFirst({ where: { id, userId } });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filePath = join(process.cwd(), "data", "uploads", attachment.filename);
  if (!existsSync(filePath)) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const buffer = await readFile(filePath);

  const inlineMimes = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"];
  const disposition = inlineMimes.includes(attachment.mimeType)
    ? `inline; filename="${attachment.originalName}"`
    : `attachment; filename="${attachment.originalName}"`;

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

  const filePath = join(process.cwd(), "data", "uploads", attachment.filename);
  await unlink(filePath).catch(() => {});

  return new Response(null, { status: 204 });
}
