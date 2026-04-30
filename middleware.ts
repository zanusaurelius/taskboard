import { auth } from "@/auth";
import { NextResponse } from "next/server";

function buildCSP(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
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

export default auth((req) => {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const isAuthenticated = !!req.auth?.user?.id;
  const { pathname } = req.nextUrl;

  const isPublicPage = pathname === "/login" || pathname === "/register" || pathname === "/recover";
  const isAuthApi    = pathname.startsWith("/api/auth");

  if (isAuthenticated && isPublicPage) {
    const res = NextResponse.redirect(new URL("/", req.nextUrl));
    applySecurityHeaders(res, nonce);
    return res;
  }

  if (!isAuthenticated && !isPublicPage && !isAuthApi) {
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      applySecurityHeaders(res, nonce);
      return res;
    }
    const res = NextResponse.redirect(new URL("/login", req.nextUrl));
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
