import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { JudgeServiceError, assertJudgingOpen, whileJudgingOpen } from "@/lib/judges";

/**
 * Disqualify / reinstate a team (organizer only).
 *
 * A disqualified team is excluded from the official ranking: no rank, cannot
 * win or tie, and not required for finalization (see judgeResults.ts). Its judge
 * evaluations are kept, only ignored. Changes are only possible while judging is
 * open — after finalization or publication, reopen judging first. The write goes
 * through whileJudgingOpen, so it is serialized against finalization and can
 * never land after the snapshot was taken.
 *
 * `db` is injected so the logic can be tested with an in-memory fake.
 */

export type DisqualificationDb = Pick<PrismaClient, "team" | "resultsPublication" | "$transaction" | "$queryRaw">;

export const LOCKED_MSG = "Results are finalized. Reopen judging before disqualifying or reinstating a team.";

export const disqualifyInput = z
  .object({ reason: z.string().trim().min(3, "give a short reason (at least 3 characters)").max(500) })
  .strict();

const SELECT = { id: true, teamCode: true, name: true, disqualifiedAt: true, disqualifiedReason: true } as const;

async function findTeam(db: DisqualificationDb, teamId: string) {
  const team = await db.team.findUnique({ where: { id: teamId }, select: SELECT });
  if (!team) throw new JudgeServiceError(404, "Team not found");
  return team;
}

/** Exclude a team from the ranking. 409 if already disqualified or judging is finalized. */
export async function disqualifyTeam(db: DisqualificationDb, teamId: string, input: z.input<typeof disqualifyInput>) {
  const { reason } = disqualifyInput.parse(input);
  const team = await findTeam(db, teamId);
  await assertJudgingOpen(db, LOCKED_MSG);
  if (team.disqualifiedAt) throw new JudgeServiceError(409, `${team.teamCode} is already disqualified.`);

  const [updated] = await whileJudgingOpen(
    db,
    [db.team.update({ where: { id: teamId }, data: { disqualifiedAt: new Date(), disqualifiedReason: reason }, select: SELECT })],
    LOCKED_MSG,
  );
  return updated;
}

/** Put a disqualified team back into the ranking. 409 if it isn't disqualified or judging is finalized. */
export async function reinstateTeam(db: DisqualificationDb, teamId: string) {
  const team = await findTeam(db, teamId);
  await assertJudgingOpen(db, LOCKED_MSG);
  if (!team.disqualifiedAt) throw new JudgeServiceError(409, `${team.teamCode} is not disqualified.`);

  const [updated] = await whileJudgingOpen(
    db,
    [db.team.update({ where: { id: teamId }, data: { disqualifiedAt: null, disqualifiedReason: null }, select: SELECT })],
    LOCKED_MSG,
  );
  return updated;
}
