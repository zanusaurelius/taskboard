import { NextResponse } from "next/server";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { weekStartsOn: true } });
  return NextResponse.json({ weekStartsOn: user?.weekStartsOn === 1 ? 1 : 0 });
}

export async function PATCH(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const weekStartsOn = body?.weekStartsOn;
  if (weekStartsOn !== 0 && weekStartsOn !== 1) {
    return NextResponse.json({ error: "weekStartsOn must be 0 (Sunday) or 1 (Monday)" }, { status: 400 });
  }

  await prisma.user.update({ where: { id: userId }, data: { weekStartsOn } });
  return NextResponse.json({ weekStartsOn });
}
