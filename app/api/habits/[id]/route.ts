import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.habit.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { text, encText, position, kind, archived } = body;

  if (text !== undefined && typeof text === "string" && text.length > 200) {
    return NextResponse.json({ error: "text must be at most 200 characters" }, { status: 400 });
  }
  if (kind !== undefined && kind !== "GOOD" && kind !== "BAD") {
    return NextResponse.json({ error: "kind must be GOOD or BAD" }, { status: 400 });
  }
  if (archived !== undefined && typeof archived !== "boolean") {
    return NextResponse.json({ error: "archived must be a boolean" }, { status: 400 });
  }

  // The server runs in UTC, so "today" has to come from the client. Older clients don't send
  // it; fall back to the server's date for them.
  const { searchParams } = new URL(request.url);
  const qDate = searchParams.get("date");
  const date = qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : new Date().toISOString().slice(0, 10);

  const [habit, log] = await Promise.all([
    prisma.habit.update({
      where: { id },
      data: {
        ...(text !== undefined && { text }),
        ...(encText !== undefined && { encText }),
        ...(position !== undefined && { position }),
        ...(kind !== undefined && { kind }),
        ...(archived !== undefined && { archivedAt: archived ? (existing.archivedAt ?? new Date()) : null }),
      },
    }),
    prisma.habitCompletion.findFirst({ where: { habitId: id, date } }),
  ]);
  return NextResponse.json({
    ...habit,
    todayOutcome: log ? (log.isLoss ? "L" : "W") : null,
    completedToday: !!log && !log.isLoss,
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.habit.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.habit.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
