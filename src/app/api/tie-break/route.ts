import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { HttpError, requireOrganizer } from "@/lib/requireOrganizer";
import {
  getTieBreakAudits,
  getUnresolvedTies,
  resolveOrganizerTie,
  saveTieBreakConfig,
  getActiveTieBreakConfig,
} from "@/lib/evalRunEngine";

// ---------------------------------------------------------------------------
// GET /api/tie-break?runId=<id>          — tie-break audit trail for a run
// GET /api/tie-break?runId=<id>&unresolved=1 — unresolved ties only
// GET /api/tie-break?config=1            — current tie-break config
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    await requireOrganizer();
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const { searchParams } = new URL(req.url);

  // Config query.
  if (searchParams.get("config") === "1") {
    const config = await getActiveTieBreakConfig();
    return NextResponse.json({ config: config ?? null });
  }

  const runId = searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "Provide ?runId=<id>" }, { status: 400 });
  }

  if (searchParams.get("unresolved") === "1") {
    const unresolved = await getUnresolvedTies(runId);
    return NextResponse.json({ unresolved });
  }

  const audits = await getTieBreakAudits(runId);
  return NextResponse.json({ audits });
}

// ---------------------------------------------------------------------------
// POST /api/tie-break — organizer resolves a tie OR saves config
// ---------------------------------------------------------------------------

const resolveInput = z.object({
  action: z.enum(["resolve", "config"]),
  // For resolve:
  runId: z.string().trim().optional(),
  tiedTeamIds: z.array(z.string()).min(2).optional(),
  resolvedOrder: z.array(z.string()).min(2).optional(),
  note: z.string().max(1000).optional(),
  // For config:
  priorityOrder: z.array(z.string()).min(1).optional(),
  name: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  let userId: string | undefined;
  try {
    const session = await requireOrganizer();
    userId = (session as { user?: { id?: string } })?.user?.id;
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let body;
  try {
    body = resolveInput.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError)
      return NextResponse.json({ error: e.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    if (body.action === "config") {
      if (!body.priorityOrder) {
        return NextResponse.json({ error: "priorityOrder is required for config" }, { status: 400 });
      }
      const config = await saveTieBreakConfig(body.priorityOrder, {
        name: body.name,
        createdBy: userId,
      });
      return NextResponse.json(config, { status: 201 });
    }

    // resolve
    if (!body.runId || !body.tiedTeamIds || !body.resolvedOrder || !body.note) {
      return NextResponse.json(
        { error: "runId, tiedTeamIds, resolvedOrder, and note are all required for resolve" },
        { status: 400 },
      );
    }

    const run = await resolveOrganizerTie(body.runId, {
      tiedTeamIds: body.tiedTeamIds,
      resolvedOrder: body.resolvedOrder,
      note: body.note,
      decidedBy: userId,
    });
    return NextResponse.json(run);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
