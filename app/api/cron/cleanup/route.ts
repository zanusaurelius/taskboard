export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { del } from "@vercel/blob";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const expiredUsers = await prisma.user.findMany({
    where: { isAnonymous: true, anonymousExpiresAt: { lt: cutoff } },
    select: {
      id: true,
      uploads: { select: { blobUrl: true } },
      attachments: { where: { uploadId: null }, select: { blobUrl: true } },
    },
  });

  for (const user of expiredUsers) {
    // Delete blob storage files before removing DB records
    for (const upload of user.uploads) {
      if (upload.blobUrl) del(upload.blobUrl).catch(() => {});
    }
    for (const att of user.attachments) {
      if (att.blobUrl) del(att.blobUrl).catch(() => {});
    }
    // Cascade deletes handle all related records (projects, notes, tasks, etc.)
    await prisma.user.delete({ where: { id: user.id } });
  }

  // Clean up expired rate limit entries (older than 1 hour)
  await prisma.rateLimit.deleteMany({ where: { hit: { lt: new Date(Date.now() - 60 * 60 * 1000) } } });

  return NextResponse.json({ deleted: expiredUsers.length });
}
