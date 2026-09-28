import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Judge accounts + team assignments (manual judging).
 *
 * Judges are ordinary `User` rows with role JUDGE — same table, same NextAuth
 * credentials login, same bcrypt hashing as the seed. Nothing here touches the
 * AI evaluation models.
 *
 * Every function takes the Prisma client as `db` so the logic can be unit
 * tested against an in-memory fake (see tests/judges.test.ts). API routes and
 * pages pass the shared `prisma` singleton.
 *
 * Security rules enforced here (not in the UI):
 *  - the role of a created judge is always JUDGE; the client cannot choose it
 *  - organizer endpoints only ever act on users whose role is JUDGE
 *  - judge-facing reads take the judge id from the server session, never the client
 *  - disabling a judge never deletes assignments
 */

export type JudgeDb = Pick<PrismaClient, "user" | "team" | "judgeAssignment" | "$transaction">;

export class JudgeServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Same cost factor as prisma/seed.ts. */
const BCRYPT_ROUNDS = 10;

/** Fields safe to return to the client — never passwordHash. */
export const JUDGE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type JudgeSummary = Prisma.UserGetPayload<{ select: typeof JUDGE_SELECT }> & {
  assignmentCount: number;
};

const TEAM_SELECT = { id: true, teamCode: true, name: true, projectTitle: true } as const;
export type AssignedTeam = Prisma.TeamGetPayload<{ select: typeof TEAM_SELECT }> & { assignedAt: Date };

// ---------------------------------------------------------------------------
// Input validation (strict: unknown keys such as `role` are rejected)
// ---------------------------------------------------------------------------

const email = z.string().trim().toLowerCase().email("enter a valid email").max(200);
const password = z.string().min(8, "password must be at least 8 characters").max(200);
const name = z.string().trim().min(1, "name is required").max(200);

export const judgeCreateInput = z.object({ name, email, password }).strict();

export const judgeUpdateInput = z
  .object({ name: name.optional(), email: email.optional(), password: password.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing to update" });

export const assignmentAddInput = z
  .object({ teamIds: z.array(z.string().trim().min(1)).min(1, "select at least one team").max(500) })
  .strict();

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// ---------------------------------------------------------------------------
// Organizer: judge accounts
// ---------------------------------------------------------------------------

export async function listJudges(db: JudgeDb): Promise<JudgeSummary[]> {
  const judges = await db.user.findMany({
    where: { role: "JUDGE" },
    orderBy: [{ active: "desc" }, { name: "asc" }, { email: "asc" }],
    select: { ...JUDGE_SELECT, _count: { select: { judgeAssignments: true } } },
  });
  return judges.map(({ _count, ...j }) => ({ ...j, assignmentCount: _count.judgeAssignments }));
}

/** A JUDGE user by id, or 404 (also 404 for organizers — this API never exposes them). */
export async function getJudge(db: JudgeDb, id: string): Promise<JudgeSummary> {
  const j = await db.user.findFirst({
    where: { id, role: "JUDGE" },
    select: { ...JUDGE_SELECT, _count: { select: { judgeAssignments: true } } },
  });
  if (!j) throw new JudgeServiceError(404, "Judge not found");
  const { _count, ...rest } = j;
  return { ...rest, assignmentCount: _count.judgeAssignments };
}

export async function createJudge(db: JudgeDb, input: z.input<typeof judgeCreateInput>) {
  const data = judgeCreateInput.parse(input);

  const existing = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) throw new JudgeServiceError(409, `An account with email "${data.email}" already exists`);

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  try {
    return await db.user.create({
      data: { name: data.name, email: data.email, passwordHash, role: "JUDGE", active: true },
      select: JUDGE_SELECT,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new JudgeServiceError(409, `An account with email "${data.email}" already exists`);
    throw e;
  }
}

/** Edit name/email, reset password, or enable/disable. Never changes role. */
export async function updateJudge(db: JudgeDb, id: string, input: z.input<typeof judgeUpdateInput>) {
  const data = judgeUpdateInput.parse(input);
  await getJudge(db, id);

  if (data.email) {
    const clash = await db.user.findFirst({ where: { email: data.email, NOT: { id } }, select: { id: true } });
    if (clash) throw new JudgeServiceError(409, `An account with email "${data.email}" already exists`);
  }

  try {
    return await db.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.password !== undefined ? { passwordHash: await bcrypt.hash(data.password, BCRYPT_ROUNDS) } : {}),
      },
      select: JUDGE_SELECT,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new JudgeServiceError(409, `An account with email "${data.email}" already exists`);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Organizer: assignments
// ---------------------------------------------------------------------------

export async function listAssignments(db: JudgeDb, judgeId: string): Promise<AssignedTeam[]> {
  await getJudge(db, judgeId);
  return teamsForJudge(db, judgeId);
}

/**
 * Assign teams to a judge. All-or-nothing: rejected if the judge is not a
 * JUDGE, any team does not exist, the request repeats a team, or any team is
 * already assigned to this judge.
 */
export async function assignTeams(db: JudgeDb, judgeId: string, input: z.input<typeof assignmentAddInput>) {
  const { teamIds } = assignmentAddInput.parse(input);
  await getJudge(db, judgeId);

  if (new Set(teamIds).size !== teamIds.length) {
    throw new JudgeServiceError(400, "The same team appears more than once in the request");
  }

  const teams = await db.team.findMany({ where: { id: { in: teamIds } }, select: { id: true } });
  const found = new Set(teams.map((t) => t.id));
  const missing = teamIds.filter((id) => !found.has(id));
  if (missing.length) throw new JudgeServiceError(404, `Team(s) not found: ${missing.join(", ")}`);

  const already = await db.judgeAssignment.findMany({
    where: { judgeId, teamId: { in: teamIds } },
    select: { team: { select: { teamCode: true } } },
  });
  if (already.length) {
    throw new JudgeServiceError(409, `Already assigned to this judge: ${already.map((a) => a.team.teamCode).join(", ")}`);
  }

  try {
    await db.$transaction(teamIds.map((teamId) => db.judgeAssignment.create({ data: { judgeId, teamId } })));
  } catch (e) {
    if (isUniqueViolation(e)) throw new JudgeServiceError(409, "One or more teams are already assigned to this judge");
    throw e;
  }
  return teamsForJudge(db, judgeId);
}

export async function removeAssignment(db: JudgeDb, judgeId: string, teamId: string) {
  await getJudge(db, judgeId);
  const { count } = await db.judgeAssignment.deleteMany({ where: { judgeId, teamId } });
  if (count === 0) throw new JudgeServiceError(404, "Assignment not found");
}

// ---------------------------------------------------------------------------
// Judge-facing (Phase 3 data layer). `judgeId` MUST come from the server session.
// ---------------------------------------------------------------------------

/** The signed-in user as an active judge, or null (wrong role, disabled, or deleted). */
export async function getActiveJudge(db: JudgeDb, userId: string) {
  const j = await db.user.findFirst({
    where: { id: userId, role: "JUDGE", active: true },
    select: { id: true, name: true, email: true },
  });
  return j ?? null;
}

export async function teamsForJudge(db: JudgeDb, judgeId: string): Promise<AssignedTeam[]> {
  const rows = await db.judgeAssignment.findMany({
    where: { judgeId },
    orderBy: { team: { teamCode: "asc" } },
    select: { createdAt: true, team: { select: TEAM_SELECT } },
  });
  return rows.map((r) => ({ ...r.team, assignedAt: r.createdAt }));
}

export async function assignmentCountForJudge(db: JudgeDb, judgeId: string): Promise<number> {
  return db.judgeAssignment.count({ where: { judgeId } });
}

/** The team if it is assigned to this judge, else null. The only gate for judge team access. */
export async function getAssignedTeam(db: JudgeDb, judgeId: string, teamId: string) {
  const a = await db.judgeAssignment.findUnique({
    where: { judgeId_teamId: { judgeId, teamId } },
    select: { createdAt: true, team: { select: TEAM_SELECT } },
  });
  return a ? { ...a.team, assignedAt: a.createdAt } : null;
}
