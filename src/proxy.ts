import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";

// authConfig itself stays Prisma-free (kept minimal/portable -- see its own
// comment), but proxy.ts can use Prisma directly: Next.js 16 renamed
// middleware.ts to proxy.ts specifically because it dropped Edge Runtime
// support there -- proxy always runs on the Node.js runtime now (see
// node_modules/next/dist/docs .../upgrading/version-16.md, "middleware to
// proxy"), so Node-only DB code is safe here.
const { auth } = NextAuth(authConfig);

const SESSION_COOKIE_PREFIXES = ["authjs.session-token", "__Secure-authjs.session-token"];

// Deactivating a user only updates the DB -- their existing JWT still says
// status: ACTIVE until it's re-issued at next login. Clearing the cookie here
// forces that: the very next /admin request they make gets signed out
// instead of trusting the stale token.
function clearSessionCookies(response: NextResponse, requestCookies: { name: string }[]) {
  for (const cookie of requestCookies) {
    if (SESSION_COOKIE_PREFIXES.some((prefix) => cookie.name.startsWith(prefix))) {
      response.cookies.delete(cookie.name);
    }
  }
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const isAdminRoute = pathname.startsWith("/admin");
  if (!isAdminRoute) return NextResponse.next();

  const user = req.auth?.user;
  if (!user) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user.status !== "ACTIVE") {
    return NextResponse.redirect(new URL("/pending", req.nextUrl.origin));
  }

  // The JWT's status is only as fresh as the last login -- re-check the DB so
  // a super admin deactivating this user takes effect immediately, not just
  // on their next sign-in.
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { status: true } });
  if (!dbUser || dbUser.status !== "ACTIVE") {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("error", "disabled");
    const response = NextResponse.redirect(loginUrl);
    clearSessionCookies(response, req.cookies.getAll());
    return response;
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
