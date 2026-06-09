import { NextResponse } from "next/server";

export async function GET() {
  // Neon PostgreSQL is always available — no unlock flow needed
  return NextResponse.json({ state: "unlocked" });
}
