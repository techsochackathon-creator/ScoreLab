import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTrackLeaderboard } from "@/lib/leaderboard";

/** GET /api/leaderboard?trackId=... — ranked leaderboard for a track (organizer). */
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

  const leaderboard = await getTrackLeaderboard(trackId);
  if (!leaderboard) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  return NextResponse.json(leaderboard);
}
