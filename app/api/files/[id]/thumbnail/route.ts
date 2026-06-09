export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserIdWithQueryToken } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserIdWithQueryToken(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const upload = await prisma.upload.findFirst({ where: { id, userId } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // No server-side thumbnail generation on Vercel — redirect to the blob URL directly
  if (upload.blobUrl) {
    return NextResponse.redirect(upload.blobUrl);
  }

  return NextResponse.json({ error: "No thumbnail available" }, { status: 404 });
}
