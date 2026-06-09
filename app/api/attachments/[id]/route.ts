export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { getUserId, getUserIdWithQueryToken } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdWithQueryToken(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const attachment = await prisma.attachment.findFirst({
    where: { id, userId },
    select: { id: true, filename: true, originalName: true, mimeType: true, size: true, uploadId: true, blobUrl: true },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // For linked attachments, resolve blob URL from the source Upload
  let blobUrl = attachment.blobUrl;
  if (!blobUrl && attachment.uploadId) {
    const upload = await prisma.upload.findFirst({
      where: { id: attachment.uploadId, userId, deletedAt: null },
      select: { blobUrl: true },
    });
    blobUrl = upload?.blobUrl ?? null;
  }

  if (blobUrl) {
    return NextResponse.redirect(blobUrl);
  }

  return NextResponse.json({ error: "File not found" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const attachment = await prisma.attachment.findFirst({
    where: { id, userId },
    select: { id: true, filename: true, uploadId: true, blobUrl: true },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.attachment.delete({ where: { id } });

  // Only delete the blob for non-linked attachments (linked ones share the Upload's blob)
  if (!attachment.uploadId && attachment.blobUrl) {
    del(attachment.blobUrl).catch(() => {});
  }

  return new Response(null, { status: 204 });
}
