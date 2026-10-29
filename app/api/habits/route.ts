import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const includeArchived = searchParams.get("includeArchived") === "true";

  const habits = await prisma.habit.findMany({
    where: { userId, ...(!includeArchived && { archivedAt: null }) },
    include: {
      completions: DATE_RE.test(date) ? { where: { date } } : false,
    },
    orderBy: { position: "asc" },
  });

  return NextResponse.json(
    habits.map((h) => {
      const log = Array.isArray(h.completions) ? h.completions[0] : undefined;
      return {
        id: h.id,
        text: h.text,
        encText: h.encText,
        kind: h.kind,
        archivedAt: h.archivedAt,
        private: h.private,
        position: h.position,
        createdAt: h.createdAt,
        todayOutcome: log ? (log.isLoss ? "L" : "W") : null,
        // Older clients only know "done today"; a W is the closest meaning.
        completedToday: !!log && !log.isLoss,
      };
    })
  );
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { text, encText, kind = "GOOD", private: isPrivate = false } = body;

  const hasPlaintext = typeof text === "string" && text.trim().length > 0;
  const hasEncrypted = typeof encText === "string" && encText.length > 0;
  if (!hasPlaintext && !hasEncrypted) {
    return NextResponse.json({ error: "text or encText is required" }, { status: 400 });
  }
  if (text && text.length > 200) {
    return NextResponse.json({ error: "text must be at most 200 characters" }, { status: 400 });
  }
  if (kind !== "GOOD" && kind !== "BAD") {
    return NextResponse.json({ error: "kind must be GOOD or BAD" }, { status: 400 });
  }
  if (typeof isPrivate !== "boolean") {
    return NextResponse.json({ error: "private must be a boolean" }, { status: 400 });
  }

  const count = await prisma.habit.count({ where: { userId } });
  const habit = await prisma.habit.create({
    data: {
      text: hasPlaintext ? text.trim() : "",
      ...(encText !== undefined && { encText }),
      kind,
      private: isPrivate,
      position: count,
      userId,
    },
  });
  return NextResponse.json({ ...habit, todayOutcome: null, completedToday: false }, { status: 201 });
}
