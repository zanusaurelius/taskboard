import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";

  const habits = await prisma.habit.findMany({
    where: { userId },
    include: {
      completions: date ? { where: { date } } : false,
    },
    orderBy: { position: "asc" },
  });

  return NextResponse.json(
    habits.map((h) => ({
      id: h.id,
      text: h.text,
      encText: h.encText,
      position: h.position,
      completedToday: Array.isArray(h.completions) && h.completions.length > 0,
    }))
  );
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { text, encText } = body;

  const hasPlaintext = typeof text === "string" && text.trim().length > 0;
  const hasEncrypted = typeof encText === "string" && encText.length > 0;
  if (!hasPlaintext && !hasEncrypted) {
    return NextResponse.json({ error: "text or encText is required" }, { status: 400 });
  }
  if (text && text.length > 200) {
    return NextResponse.json({ error: "text must be at most 200 characters" }, { status: 400 });
  }

  const count = await prisma.habit.count({ where: { userId } });
  const habit = await prisma.habit.create({
    data: {
      text: hasPlaintext ? text.trim() : "",
      ...(encText !== undefined && { encText }),
      position: count,
      userId,
    },
  });
  return NextResponse.json({ ...habit, completedToday: false }, { status: 201 });
}
