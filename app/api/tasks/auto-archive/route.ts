import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const days = typeof body?.days === "number" ? body.days : 0;
  if (!days || days < 1) return NextResponse.json({ error: "Invalid days" }, { status: 400 });

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { count } = await prisma.task.updateMany({
    where: {
      project: { userId },
      stage: "done",
      archived: false,
      OR: [
        { doneAt: { lt: cutoff } },
        { doneAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    data: { archived: true },
  });

  return NextResponse.json({ count });
}
