export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filename } = await params;
  const upload = await prisma.upload.findUnique({ where: { filename } });
  if (!upload || upload.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (upload.blobUrl) {
    return NextResponse.redirect(upload.blobUrl);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
