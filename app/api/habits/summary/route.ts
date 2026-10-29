import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

// Everything the Habits page needs in one response: every habit (archived included), its full
// log history and the user's week start. Stats are computed on the client from this, since only
// the client knows its local date. The phone caches this response for offline use.
export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user, habits] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { weekStartsOn: true } }),
    prisma.habit.findMany({
      where: { userId },
      include: { completions: { select: { date: true, isLoss: true }, orderBy: { date: "asc" } } },
      orderBy: { position: "asc" },
    }),
  ]);

  return NextResponse.json({
    weekStartsOn: user?.weekStartsOn === 1 ? 1 : 0,
    habits: habits.map((h) => ({
      id: h.id,
      text: h.text,
      encText: h.encText,
      kind: h.kind,
      archivedAt: h.archivedAt,
      private: h.private,
      position: h.position,
      createdAt: h.createdAt,
      logs: h.completions,
    })),
  });
}
