import { auth } from "@/auth";
import { NextResponse } from "next/server";
import {
  BETA_ACCESS_COOKIE_NAME,
  isBetaGateEnabled,
  verifyBetaCookie,
} from "@/src/lib/beta-access";

export default auth(async (req) => {
  const { pathname, searchParams } = req.nextUrl;
  const session = req.auth;

  // ============================================
  // BETA ACCESS GATE (highest priority — runs before maintenance)
  // ============================================
  //
  // Defense-in-depth: even before auth, require the beta password.
  // - HMAC-signed cookie verified server-side
  // - Static assets, /access, and /api/access exempt to avoid loops
  // - Optional bypass via BETA_ACCESS_DISABLED env var (dev only)
  if (isBetaGateEnabled()) {
    const betaExemptPaths = [
      "/access",
      "/api/access",
      "/_next",
      "/favicon.ico",
      "/icon.png",
      "/apple-icon.png",
      "/images",
      "/backgrounds",
    ];
    const isBetaExempt = betaExemptPaths.some((path) =>
      pathname.startsWith(path),
    );

    if (!isBetaExempt) {
      const betaCookie = req.cookies.get(BETA_ACCESS_COOKIE_NAME)?.value;
      const cookieValid = await verifyBetaCookie(betaCookie);
      if (!cookieValid) {
        const accessUrl = new URL("/access", req.url);
        // Preserve original destination so we can redirect back after gate
        if (pathname !== "/") {
          accessUrl.searchParams.set("redirect", pathname + req.nextUrl.search);
        }
        return NextResponse.redirect(accessUrl);
      }
    }
  }

  // ============================================
  // MAINTENANCE MODE CHECK
  // ============================================
  const isMaintenanceMode = process.env.MAINTENANCE_MODE === "true";

  // CRITICAL: /login and /api/auth must be exempt from maintenance mode
  // to prevent infinite redirect loop:
  // 1. User visits / → redirects to /maintenance (MAINTENANCE_MODE=true)
  // 2. /maintenance requires auth → redirects to /login
  // 3. /login not exempt → redirects to /maintenance
  // 4. LOOP ♾️
  const maintenanceExemptPaths = [
    "/maintenance",
    "/login", // Prevents loop (user can access login page)
    "/api/auth", // Prevents loop (NextAuth callbacks work)
    "/api/health",
    "/_next",
    "/favicon.ico",
  ];
  const isExempt = maintenanceExemptPaths.some((path) =>
    pathname.startsWith(path),
  );

  if (isMaintenanceMode && !isExempt) {
    return NextResponse.redirect(new URL("/maintenance", req.url));
  }

  // If NOT in maintenance but trying to access /maintenance, redirect to home
  if (pathname === "/maintenance" && !isMaintenanceMode) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // ============================================
  // AUTH CHECK (existing logic)
  // ============================================

  // Allow public pages (access, login, maintenance, auth)
  // CRITICAL: /access must be auth-public, otherwise:
  //   /access → no session → redirects /login → no beta cookie → redirects /access → LOOP
  if (
    pathname.startsWith("/access") ||
    pathname.startsWith("/api/access") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/maintenance")
  ) {
    // If already logged in and trying to access login, redirect to home
    if (pathname === "/login" && session) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // Allow all API routes (they have their own authentication)
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow home page when coming from Shopify iframe with token
  // The page will validate the token client-side via /api/shopify-customer
  if (pathname === "/" && searchParams.has("shopify_token")) {
    return NextResponse.next();
  }

  // Protect everything else - redirect to login if not authenticated
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
