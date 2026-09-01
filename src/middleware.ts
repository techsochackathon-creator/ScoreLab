import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;
    const { pathname } = req.nextUrl;

    if (pathname.startsWith("/organizer") && token?.role !== "ORGANIZER") {
      return NextResponse.redirect(new URL("/login?error=forbidden", req.url));
    }
    if (pathname.startsWith("/submit") && token?.role !== "TEAM") {
      return NextResponse.redirect(new URL("/login?error=forbidden", req.url));
    }
    return NextResponse.next();
  },
  {
    callbacks: { authorized: ({ token }) => !!token },
    pages: { signIn: "/login" },
  },
);

export const config = {
  matcher: ["/organizer/:path*", "/submit/:path*"],
};
