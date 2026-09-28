import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { homePathForRole } from "@/lib/roles";

/** Route prefix → the only role allowed under it. */
const PROTECTED: { prefix: string; role: string }[] = [
  { prefix: "/organizer", role: "ORGANIZER" },
  { prefix: "/judge", role: "JUDGE" },
];

export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;
    const { pathname } = req.nextUrl;

    const area = PROTECTED.find((a) => pathname === a.prefix || pathname.startsWith(a.prefix + "/"));
    if (area && token?.role !== area.role) {
      // Send a signed-in user of another role to their own area; anything else is forbidden.
      const home = homePathForRole(token?.role);
      return NextResponse.redirect(new URL(home ?? "/login?error=forbidden", req.url));
    }
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
