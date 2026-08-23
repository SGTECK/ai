import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Strict Content-Security-Policy + hard security headers.
 *
 * Production: no 'unsafe-eval'; scripts limited to 'self' + 'unsafe-inline'
 *   (Next.js App Router still injects small inline bootstraps without a nonce pipeline).
 * Development: allows eval + ws/http localhost for Fast Refresh / HMR.
 *
 * To go fully nonce-based later: generate a per-request nonce, pass via
 * header/request header to root layout, and attach nonce to every script.
 */

function buildCsp(isDev: boolean): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  const connectSrc = isDev
    ? "connect-src 'self' https://openrouter.ai https://*.openrouter.ai ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*"
    : "connect-src 'self' https://openrouter.ai https://*.openrouter.ai";

  const directives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://gcetly.ac.in https://*.gcetly.ac.in",
    "font-src 'self' data: https://fonts.gstatic.com",
    connectSrc,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ];

  // Report-only twin can be enabled with CSP_REPORT_ONLY=1 for testing
  return directives.join("; ");
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const isDev = process.env.NODE_ENV === "development";

  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()"
  );
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-site");
  res.headers.set("X-Permitted-Cross-Domain-Policies", "none");

  const proto =
    req.headers.get("x-forwarded-proto") ||
    req.nextUrl.protocol.replace(":", "");
  if (proto === "https") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }

  const csp = buildCsp(isDev);

  // Optional: test stricter policy without breaking users
  if (process.env.CSP_REPORT_ONLY === "1") {
    res.headers.set("Content-Security-Policy-Report-Only", csp);
  } else {
    res.headers.set("Content-Security-Policy", csp);
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
