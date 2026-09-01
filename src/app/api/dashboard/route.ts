import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTrackDashboard } from "@/lib/dashboard";

/** GET /api/dashboard?trackId=... — organizer dashboard data for one track. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.user.role !== "ORGANIZER") {
    return NextResponse.json(
      { error: "Organizer access required" },
      { status: 403 },
    );
  }

  const trackId = new URL(req.url).searchParams.get("trackId");
  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  const dashboard = await getTrackDashboard(trackId);
  if (!dashboard) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }
  return NextResponse.json(dashboard);
}
