import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { areaRedirect } from "@/lib/roles";

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;
    const redirectTo = areaRedirect(req.nextUrl.pathname, token?.role);
    if (redirectTo) return NextResponse.redirect(new URL(redirectTo, req.url));
    return NextResponse.next();
  },
  {
    callbacks: { authorized: ({ token }) => !!token },
    pages: { signIn: "/login" },
  },
);

export const config = {
  matcher: ["/organizer/:path*", "/judge/:path*"],
};
