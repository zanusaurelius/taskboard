import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

// Sets one day's outcome for a habit. Idempotent, so the phone can queue it offline and replay
// it safely: { outcome: "W" | "L" } records the day, { outcome: null } clears it.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string; date: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: habitId, date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
  if (!habit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const outcome = body?.outcome;
  if (outcome !== "W" && outcome !== "L" && outcome !== null) {
    return NextResponse.json({ error: 'outcome must be "W", "L" or null' }, { status: 400 });
  }

  if (outcome === null) {
    await prisma.habitCompletion.deleteMany({ where: { habitId, date } });
  } else {
    const isLoss = outcome === "L";
    await prisma.habitCompletion.upsert({
      where: { habitId_date: { habitId, date } },
      create: { habitId, date, isLoss },
      update: { isLoss },
    });
  }
  return NextResponse.json({ habitId, date, outcome });
}
