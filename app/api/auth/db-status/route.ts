import { NextResponse } from "next/server";
import { hasSalt, isDbUnlocked } from "@/lib/db-state";

export const runtime = "nodejs";

export async function GET() {
  if (isDbUnlocked()) {
    return NextResponse.json({ state: "unlocked" });
  }
  if (hasSalt()) {
    return NextResponse.json({ state: "locked" });
  }
  return NextResponse.json({ state: "setup" });
}
