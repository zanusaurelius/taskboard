import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filename } = await params;

  // Only allow simple filenames — block path traversal
  if (!/^[a-f0-9]+\.(jpg|png|gif|webp)$/.test(filename)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const upload = await prisma.upload.findUnique({ where: { filename } });
  if (!upload || upload.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = await readFile(join(process.cwd(), "data", "uploads", filename));
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": upload.mimeType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
