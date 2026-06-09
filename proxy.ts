import { auth } from "@/auth";
import { verifyApiToken } from "@/lib/api-token";
import { NextResponse, type NextRequest } from "next/server";

function buildCSP(nonce: string): string {
  const evalDirective = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalDirective}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: https://*.public.blob.vercel-storage.com",
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

function externalUrl(req: NextRequest, path: string): URL {
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return new URL(path, `${proto}://${host}`);
}

export default auth(async (req) => {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  let bearerAuthenticated = false;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const payload = await verifyApiToken(authHeader.slice(7));
    bearerAuthenticated = !!payload?.sub;
  }

  const isAuthenticated = !!req.auth?.user?.id || bearerAuthenticated;
  const { pathname } = req.nextUrl;

  const isPublicPage = pathname === "/login" || pathname === "/register" || pathname === "/recover";
  const isAuthApi    = pathname.startsWith("/api/auth");

  if (isAuthenticated && isPublicPage) {
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
    // Send visitors to anon-start which creates an anonymous session and redirects back
    const anonUrl = externalUrl(req, `/api/auth/anon-start`);
    anonUrl.searchParams.set("next", pathname);
    const res = NextResponse.redirect(anonUrl);
    applySecurityHeaders(res, nonce);
    return res;
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(res, nonce);
  return res;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
