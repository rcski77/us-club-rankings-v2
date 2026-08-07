import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME, hashSessionToken } from "@/lib/session";

// Next.js 16 renamed middleware.ts to proxy.ts specifically because it dropped
// Edge Runtime support here -- proxy.ts always runs on the Node.js runtime now
// (see node_modules/next/dist/docs/.../upgrading/version-16.md, "middleware to
// proxy"), so a direct Prisma query per /admin request is safe. That query is
// also the *only* check now (no JWT to fall back on) -- see src/lib/session.ts
// and src/auth.ts for the rest of the hand-rolled DB-backed session scheme.
export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin");
  if (!isAdminRoute) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: { status: true } } },
  });

  if (!session || session.expiresAt < new Date()) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  if (session.user.status === "DISABLED") {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("error", "disabled");
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  if (session.user.status !== "ACTIVE") {
    return NextResponse.redirect(new URL("/pending", req.nextUrl.origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
