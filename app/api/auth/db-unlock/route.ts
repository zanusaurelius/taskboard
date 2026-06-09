import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Neon PostgreSQL is always available — no passphrase unlock needed
export async function POST() {
  return NextResponse.json({ ok: true });
}
