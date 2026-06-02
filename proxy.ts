import { auth } from "@/auth";
import { verifyApiToken } from "@/lib/api-token";
import { NextResponse, type NextRequest } from "next/server";

function buildCSP(nonce: string): string {
  // React dev mode uses eval() for call stack reconstruction; blocked by CSP without unsafe-eval.
  // Only relax this in development — production never uses eval().
  const evalDirective = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalDirective}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function applySecurityHeaders(res: NextResponse, nonce: string): void {
  res.headers.set("Content-Security-Policy", buildCSP(nonce));
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), display-capture=()",
  );
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
}

// NextAuth rewrites req.nextUrl to its computed base URL (often localhost:3000),
// so redirects built from req.nextUrl would send the browser to localhost on the
// user's machine. Instead, read the forwarded host/protocol set by the reverse
// proxy so the Location header uses the actual external address.
function externalUrl(req: NextRequest, path: string): URL {
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return new URL(path, `${proto}://${host}`);
}

export default auth(async (req) => {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Check Bearer token (for native app) — signature only, no DB in Edge runtime.
  // Full passwordChangedAt validation happens inside each API route via getUserId().
  let bearerAuthenticated = false;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const payload = await verifyApiToken(authHeader.slice(7));
    bearerAuthenticated = !!payload?.sub;
  }

  const isAuthenticated = !!req.auth?.user?.id || bearerAuthenticated;
  const { pathname } = req.nextUrl;

  const isPublicPage = pathname === "/login" || pathname === "/register" || pathname === "/recover" || pathname === "/unlock";
  const isAuthApi    = pathname.startsWith("/api/auth");

  // DB lock gate — reads process.env.NEXT_DB_UNLOCKED set by the unlock() route
  // handler. Both middleware and route handlers run in the same Node.js process in
  // standalone mode, so process.env changes are immediately visible here. No cookie
  // needed — this is purely in-process state, cleared on server restart.
  const isDbUnlocked = process.env.NODE_ENV !== "production"
    || process.env.NEXT_DB_UNLOCKED === "1";

  if (process.env.NODE_ENV === "production") {
    const isDbApi = pathname === "/api/auth/db-status" || pathname === "/api/auth/db-unlock"
      || pathname === "/api/health" || pathname === "/api/auth/token";
    if (!isDbUnlocked && !isDbApi && pathname !== "/unlock") {
      if (pathname.startsWith("/api/")) {
        const res = NextResponse.json({ error: "Service unavailable" }, { status: 423 });
        applySecurityHeaders(res, nonce);
        return res;
      }
      const res = NextResponse.redirect(externalUrl(req, "/unlock"));
      applySecurityHeaders(res, nonce);
      return res;
    }
  }

  // Don't redirect authenticated users away from /unlock when DB is locked.
  if (isAuthenticated && isPublicPage && (isDbUnlocked || pathname !== "/unlock")) {
    const res = NextResponse.redirect(externalUrl(req, "/"));
    applySecurityHeaders(res, nonce);
    return res;
  }

  if (!isAuthenticated && !isPublicPage && !isAuthApi) {
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      applySecurityHeaders(res, nonce);
      return res;
    }
    const res = NextResponse.redirect(externalUrl(req, "/login"));
    applySecurityHeaders(res, nonce);
    return res;
  }

  // Forward nonce to server components via request header
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(res, nonce);
  return res;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
