import { auth } from "@/auth";
import { verifyApiToken } from "@/lib/api-token";
import { prisma } from "@/lib/prisma";

/**
 * Resolves the authenticated user ID from either:
 * - Authorization: Bearer <jwt>  (native mobile app)
 * - NextAuth session cookie       (web app)
 *
 * Returns null if unauthenticated or if the token was issued before a password change.
 */
/** Like getUserId but also accepts a ?token= query param for mobile Linking.openURL flows. */
export async function getUserIdWithQueryToken(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    const fakeReq = new Request(request.url, {
      headers: { Authorization: `Bearer ${queryToken}` },
    });
    return getUserId(fakeReq);
  }
  return getUserId(request);
}

export async function getUserId(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = await verifyApiToken(token);
    if (!payload?.sub) return null;

    // Reject tokens issued before the user's last password change
    try {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { passwordChangedAt: true },
      });
      if (!user) return null;
      if (user.passwordChangedAt.getTime() > payload.iat * 1000) return null;
    } catch {
      return null;
    }

    return payload.sub;
  }

  // Fall back to NextAuth session cookie
  const session = await auth();
  return session?.user?.id ?? null;
}
