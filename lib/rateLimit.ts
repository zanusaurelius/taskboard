import { prisma } from "@/lib/prisma";

let _rlCounter = 0;

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - windowMs);

    const count = await prisma.rateLimit.count({
      where: { key, hit: { gt: cutoff } },
    });

    if (count >= limit) return false;

    await prisma.rateLimit.create({ data: { key } });

    // Deterministic cleanup every 100 calls — purge expired rows to bound table growth
    if (++_rlCounter % 100 === 0) {
      prisma.rateLimit.deleteMany({ where: { hit: { lt: cutoff } } }).catch(() => {});
    }

    return true;
  } catch {
    // Fail open — a DB error should not lock users out
    return true;
  }
}

export function getClientIp(req: Request): string {
  // x-real-ip is set by trusted proxies directly from $remote_addr — not user-spoofable
  const realIp = req.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  // Rightmost x-forwarded-for entry is added by the innermost trusted proxy
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    const last = parts[parts.length - 1].trim();
    if (last) return last;
  }

  return "unknown";
}
