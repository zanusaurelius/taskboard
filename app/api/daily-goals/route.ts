import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const carryover = searchParams.get("carryover");

  if (searchParams.get("all") === "true") {
    const goals = await prisma.dailyGoal.findMany({
      where: { userId },
      orderBy: [{ date: "desc" }, { position: "asc" }],
    });
    return NextResponse.json(goals);
  }

  if (carryover === "true") {
    // Use client-supplied local date; fall back to UTC only as a last resort.
    const todayParam = searchParams.get("today") ?? "";
    const today = /^\d{4}-\d{2}-\d{2}$/.test(todayParam)
      ? todayParam
      : new Date().toISOString().slice(0, 10);
    const recent = await prisma.dailyGoal.findFirst({
      where: { userId, date: { lt: today }, completed: false },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (!recent) return NextResponse.json([]);
    const goals = await prisma.dailyGoal.findMany({
      where: { userId, date: recent.date, completed: false },
      orderBy: { position: "asc" },
    });
    return NextResponse.json(goals);
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  const goals = await prisma.dailyGoal.findMany({
    where: { userId, date },
    orderBy: { position: "asc" },
  });
  return NextResponse.json(goals);
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { text, encText, taskId, date, position, limit } = body;

  const hasPlaintext = typeof text === "string" && text.trim().length > 0;
  const hasEncrypted = typeof encText === "string" && encText.length > 0;
  if (!hasPlaintext && !hasEncrypted) {
    return NextResponse.json({ error: "text or encText is required" }, { status: 400 });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date is required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (text && text.length > 500) {
    return NextResponse.json({ error: "text must be at most 500 characters" }, { status: 400 });
  }

  const maxGoals = typeof limit === "number" && limit >= 1 && limit <= 20 ? limit : 10;
  const count = await prisma.dailyGoal.count({ where: { userId, date } });
  if (count >= maxGoals) {
    return NextResponse.json({ error: `Maximum ${maxGoals} goals per day` }, { status: 400 });
  }

  const goal = await prisma.dailyGoal.create({
    data: {
      text: hasPlaintext ? text.trim() : "",
      ...(encText !== undefined && { encText }),
      taskId: taskId ?? null,
      date,
      position: position ?? count,
      userId,
    },
  });
  return NextResponse.json(goal, { status: 201 });
}
