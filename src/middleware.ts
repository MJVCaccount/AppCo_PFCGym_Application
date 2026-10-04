import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { cspHeaderName, buildCsp, newNonce } from "@/lib/csp";
import { COOKIE_NAME, decodeSession } from "@/lib/sessionToken";
import { ROLES } from "@/lib/types";

/**
 * A coarse gate plus the Content-Security-Policy.
 *
 * The gate only checks the session cookie's signature and the role written in
 * it, so a visitor with no valid cookie is sent to sign in before the page
 * renders. It never touches the database. isActive, sessionVersion and the
 * current role are checked by getSession() and by every page and service:
 * those checks are the authoritative ones, and this is defence in depth.
 *
 * Runs on the Node.js runtime because the signature uses node:crypto.
 */

const GATED_PREFIXES = ["/dashboard", "/bookings", "/admin", "/coach"];

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Where the request must go instead, or null when it may continue. */
function gateRedirect(request: NextRequest): string | null {
  const { pathname, search } = request.nextUrl;
  if (!GATED_PREFIXES.some((prefix) => isUnder(pathname, prefix))) return null;

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? decodeSession(token) : null;
  if (!session) {
    return `/login?returnUrl=${encodeURIComponent(pathname + search)}`;
  }

  if (isUnder(pathname, "/admin") && session.role !== ROLES.Admin) {
    return "/denied";
  }
  if (
    isUnder(pathname, "/coach") &&
    session.role !== ROLES.Coach &&
    session.role !== ROLES.Admin
  ) {
    return "/denied";
  }

  return null;
}

export function middleware(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce);
  const headerName = cspHeaderName();

  const target = gateRedirect(request);
  const response = target
    ? NextResponse.redirect(new URL(target, request.url))
    : (() => {
        // Next reads the nonce from the request's policy header and puts it
        // on its own scripts; x-nonce is for anything that wants it directly.
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-nonce", nonce);
        requestHeaders.set(headerName, csp);
        return NextResponse.next({ request: { headers: requestHeaders } });
      })();

  response.headers.set(headerName, csp);
  return response;
}

export const config = {
  runtime: "nodejs",
  // Every page, but not API routes (JSON, nothing to script) or build assets.
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
