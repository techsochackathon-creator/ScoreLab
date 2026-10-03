/**
 * Disqualifying teams and reopening judging.
 * Pure ranking rules + the services, against an in-memory stand-in for Prisma.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildJudgeResults, getJudgeResults, type ResultsInput } from "../src/lib/judgeResults";
import {
  buildFinalSnapshot,
  finalizationBlockers,
  finalizeResults,
  getOfficialState,
  judgingProgress,
  reopenJudging,
  toPublicResults,
  type OfficialResultsDb,
  type FinalSnapshot,
} from "../src/lib/officialResults";
import { disqualifyTeam, reinstateTeam, type DisqualificationDb } from "../src/lib/disqualification";
import { summarizeProgress } from "../src/lib/judgeEvaluations";
import { JudgeServiceError, whileJudgingOpen } from "../src/lib/judges";
import { friendlyApiError } from "../src/lib/uiErrors";

type T = ResultsInput["teams"][number];
const team = (id: string, dq?: string): T => ({ id, teamCode: id.toUpperCase(), name: `Team ${id}`, projectTitle: null, ...(dq ? { disqualifiedAt: new Date(), disqualifiedReason: dq } : {}) });
const sub = (teamId: string, judgeId: string, finalScore: number) => ({ teamId, judgeId, status: "SUBMITTED", finalScore });
const draft = (teamId: string, judgeId: string) => ({ teamId, judgeId, status: "DRAFT", finalScore: null });
const build = (teams: T[], evaluations: ResultsInput["evaluations"]) => buildJudgeResults({ teams, evaluations, assignments: [] });

describe("ranking with disqualified teams", () => {
  it("a disqualified team gets no rank or score, is listed separately with its reason", () => {
    const r = build([team("a", "Rule violation"), team("b"), team("c")], [sub("a", "j1", 95), sub("b", "j1", 80), sub("c", "j1", 70)]);
    assert.deepEqual(r.ranked.map((t) => [t.teamId, t.rank]), [["b", 1], ["c", 2]]);
    assert.deepEqual(r.disqualified, [{ teamId: "a", teamCode: "A", name: "Team a", reason: "Rule violation" }]);
    assert.ok(![...r.ranked, ...r.incomplete].some((t) => t.teamId === "a"));
  });

  it("the highest-scoring team being disqualified hands the win to the next team", () => {
    const evals = [sub("a", "j1", 95), sub("b", "j1", 80), sub("c", "j1", 70)];
    assert.equal(build([team("a"), team("b"), team("c")], evals).winnerTeamId, "a");
    const after = build([team("a", "x"), team("b"), team("c")], evals);
    assert.equal(after.status, "WINNER");
    assert.equal(after.winnerTeamId, "b");
  });

  it("a disqualified team cannot create or join a tie", () => {
    const r = build([team("a", "x"), team("b"), team("c")], [sub("a", "j1", 80), sub("b", "j1", 80), sub("c", "j1", 60)]);
    assert.equal(r.status, "WINNER");
    assert.equal(r.winnerTeamId, "b");
    assert.deepEqual(r.ties, []);
  });

  it("a disqualified team is not required for finalization (no evaluation needed)", () => {
    const open = build([team("a"), team("b"), team("c")], [sub("a", "j1", 90), sub("b", "j1", 80)]);
    assert.match(finalizationBlockers(open).join(" "), /C has no submitted evaluation/);
    const dq = build([team("a"), team("b"), team("c", "x")], [sub("a", "j1", 90), sub("b", "j1", 80)]);
    assert.deepEqual(finalizationBlockers(dq), []);
  });

  it("progress and judge workloads ignore disqualified teams", () => {
    const r = build([team("a"), team("b", "x"), team("c")], [sub("a", "j1", 90), draft("c", "j1")]);
    const p = judgingProgress(r);
    assert.deepEqual([p.totalTeams, p.withSubmitted, p.draftsOnly], [2, 1, 1]);
    assert.deepEqual(summarizeProgress(["SUBMITTED", "DRAFT"]).assigned, 2);
  });

  it("all teams disqualified → nothing to finalize", () => {
    const r = build([team("a", "x")], [sub("a", "j1", 90)]);
    assert.deepEqual(finalizationBlockers(r), ["Cannot finalize: there are no teams."]);
  });

  it("snapshot lists disqualified teams (no scores, no reason); the public view shows name + code only", () => {
    const r = build([team("a", "Secret reason"), team("b"), team("c")], [sub("a", "j1", 95), sub("b", "j1", 80), sub("c", "j1", 70)]);
    const snap = buildFinalSnapshot(r);
    assert.deepEqual(snap.disqualified, [{ teamId: "a", teamCode: "A", teamName: "Team a" }]);
    assert.ok(!JSON.stringify(snap).includes("Secret reason"));
    assert.ok(snap.teams.every((t) => t.teamId !== "a"));
    const pub = toPublicResults(snap);
    assert.deepEqual(pub.disqualified, [{ teamCode: "A", teamName: "Team a" }]);
    const json = JSON.stringify(pub);
    assert.ok(!json.includes("Secret reason") && !json.includes("95") && !json.includes('"teamId"'));
  });

  it("older snapshots without a disqualified list still render", () => {
    const old: FinalSnapshot = { version: 1, winnerTeamId: "b", teams: [{ teamId: "b", teamCode: "B", teamName: "Team b", judgeScore: 80, rank: 1, isWinner: true }] };
    assert.deepEqual(toPublicResults(old).disqualified, []);
  });
});

// ---------------------------------------------------------------------------
// Services (in-memory DB)
// ---------------------------------------------------------------------------

/** Like a PrismaPromise: runs only when awaited or executed by $transaction. */
const lazy = <X>(run: () => Promise<X>): Promise<X> => {
  let p: Promise<X> | undefined;
  const get = () => (p ??= run());
  return { then: (a, b) => get().then(a, b), catch: (b) => get().catch(b), finally: (f) => get().finally(f), [Symbol.toStringTag]: "Promise" } as Promise<X>;
};

interface MTeam { id: string; teamCode: string; name: string; projectTitle: string | null; disqualifiedAt: Date | null; disqualifiedReason: string | null }
type Row = { slot: string; finalizedById: string; finalizedAt: Date; snapshot: unknown; publishedAt: Date | null };

function makeDb(teamIds: string[], evaluations: ResultsInput["evaluations"]) {
  const teams: MTeam[] = teamIds.map((id) => ({ id, teamCode: id.toUpperCase(), name: `Team ${id}`, projectTitle: null, disqualifiedAt: null, disqualifiedReason: null }));
  let row: Row | null = null;
  const evalsBefore = JSON.stringify(evaluations);
  const db = {
    team: {
      findMany: async () => teams.map((t) => ({ ...t })),
      findUnique: async ({ where }: { where: { id: string } }) => { const t = teams.find((x) => x.id === where.id); return t ? { ...t } : null; },
      update: ({ where, data }: { where: { id: string }; data: Partial<MTeam> }) => lazy(async () => ({ ...Object.assign(teams.find((t) => t.id === where.id)!, data) })),
    },
    judgeEvaluation: { findMany: async () => evaluations.map((e) => ({ ...e })), count: async () => evaluations.filter((e) => e.status === "SUBMITTED").length },
    judgeAssignment: { findMany: async () => [] },
    resultsPublication: {
      findFirst: async () => (row ? structuredClone(row) : null),
      create: async ({ data }: { data: { finalizedById: string; snapshot: unknown } }) => {
        if (row) throw Object.assign(new Error("dup"), { code: "P2002" });
        row = { slot: "OFFICIAL", finalizedById: data.finalizedById, finalizedAt: new Date(), snapshot: structuredClone(data.snapshot), publishedAt: null };
        return row;
      },
      deleteMany: async () => { const count = row ? 1 : 0; row = null; return { count }; },
    },
    $queryRaw: (strings: TemplateStringsArray) => lazy(async () => {
      if (strings.join("?").includes("JUDGING_FINALIZED") && row) throw new Error('invalid input syntax for type integer: "OFFICIAL:JUDGING_FINALIZED"');
      return [{ ok: 1 }];
    }),
    $transaction: async (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
      const savedRow = row; const savedTeams = structuredClone(teams);
      try {
        if (typeof arg === "function") return await arg(db);
        const out: unknown[] = []; for (const op of arg) out.push(await op); return out;
      } catch (e) {
        row = savedRow; teams.forEach((t, i) => Object.assign(t, savedTeams[i])); throw e;
      }
    },
  };
  return { db: db as unknown as OfficialResultsDb & DisqualificationDb, teams, evaluationsUntouched: () => JSON.stringify(evaluations) === evalsBefore };
}

async function rejects(p: Promise<unknown>, status: number, match?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof JudgeServiceError, `expected JudgeServiceError, got ${String(e)}`);
    assert.equal(e.status, status);
    if (match) assert.match(e.message, match);
    return true;
  });
}

const EVALS = () => [sub("a", "j1", 95), sub("b", "j1", 80), sub("c", "j1", 70)];

describe("disqualify / reinstate", () => {
  it("disqualifies with a reason; the team drops out of the live results; reinstating brings it back", async () => {
    const t = makeDb(["a", "b", "c"], EVALS());
    const updated = await disqualifyTeam(t.db, "a", { reason: "  Plagiarism  " });
    assert.equal(updated.disqualifiedReason, "Plagiarism");
    assert.ok(updated.disqualifiedAt);
    let r = await getJudgeResults(t.db);
    assert.equal(r.winnerTeamId, "b");
    assert.deepEqual(r.disqualified.map((d) => d.teamId), ["a"]);

    await reinstateTeam(t.db, "a");
    assert.equal(t.teams[0].disqualifiedAt, null);
    assert.equal(t.teams[0].disqualifiedReason, null);
    r = await getJudgeResults(t.db);
    assert.equal(r.winnerTeamId, "a");
  });

  it("requires a reason, rejects extra fields, unknown teams, and repeats", async () => {
    const t = makeDb(["a", "b"], EVALS());
    await assert.rejects(disqualifyTeam(t.db, "a", { reason: "" }), (e: unknown) => e instanceof Error && e.name === "ZodError");
    await assert.rejects(disqualifyTeam(t.db, "a", { reason: "no", } as never));
    await assert.rejects(disqualifyTeam(t.db, "a", { reason: "valid reason", disqualifiedAt: "2020-01-01" } as never));
    await rejects(disqualifyTeam(t.db, "zzz", { reason: "valid reason" }), 404);
    await disqualifyTeam(t.db, "a", { reason: "valid reason" });
    await rejects(disqualifyTeam(t.db, "a", { reason: "again again" }), 409, /already disqualified/);
    await rejects(reinstateTeam(t.db, "b"), 409, /not disqualified/);
  });

  it("is blocked once results are finalized (409, nothing changes) — reinstating too", async () => {
    const t = makeDb(["a", "b", "c"], EVALS());
    await disqualifyTeam(t.db, "c", { reason: "valid reason" });
    await finalizeResults(t.db, "org1");
    await rejects(disqualifyTeam(t.db, "b", { reason: "valid reason" }), 409, /Reopen judging/);
    await rejects(reinstateTeam(t.db, "c"), 409, /Reopen judging/);
    assert.equal(t.teams[1].disqualifiedAt, null);
    assert.ok(t.teams[2].disqualifiedAt);
  });

  it("race: a disqualification that passes the pre-check but meets a finalized record is refused by the guarded write", async () => {
    const t = makeDb(["a", "b", "c"], EVALS());
    await finalizeResults(t.db, "org1");
    await rejects(whileJudgingOpen(t.db, [t.db.team.update({ where: { id: "a" }, data: { disqualifiedAt: new Date() } })]), 409);
    assert.equal(t.teams[0].disqualifiedAt, null);
  });
});

describe("reopening judging", () => {
  it("deletes only the official result; evaluations are untouched and judging is open again", async () => {
    const t = makeDb(["a", "b", "c"], EVALS());
    await finalizeResults(t.db, "org1");
    assert.ok(await getOfficialState(t.db));
    await reopenJudging(t.db);
    assert.equal(await getOfficialState(t.db), null);
    assert.ok(t.evaluationsUntouched());
    // locks are lifted: writes guarded by whileJudgingOpen work again
    await disqualifyTeam(t.db, "a", { reason: "valid reason" });
  });

  it("nothing to reopen → 409", async () => {
    const t = makeDb(["a"], [sub("a", "j1", 90)]);
    await rejects(reopenJudging(t.db), 409, /nothing to reopen/);
  });

  it("full flow: finalize → reopen → disqualify the winner → finalize again gives the new winner and snapshot", async () => {
    const t = makeDb(["a", "b", "c"], EVALS());
    const first = await finalizeResults(t.db, "org1");
    assert.equal(first.snapshot.winnerTeamId, "a");

    await reopenJudging(t.db);
    await disqualifyTeam(t.db, "a", { reason: "Rule violation" });
    const second = await finalizeResults(t.db, "org1");

    assert.equal(second.snapshot.winnerTeamId, "b");
    assert.deepEqual(second.snapshot.teams.map((x) => [x.teamCode, x.rank, x.isWinner]), [["B", 1, true], ["C", 2, false]]);
    assert.deepEqual(second.snapshot.disqualified, [{ teamId: "a", teamCode: "A", teamName: "Team a" }]);
    assert.ok(!JSON.stringify(second.snapshot).includes("Rule violation"));
    assert.ok(t.evaluationsUntouched());
  });
});

describe("error messages", () => {
  it("keeps the specific 'reopen judging' and 'nothing to reopen' messages", () => {
    const locked = "Results are finalized. Reopen judging before disqualifying or reinstating a team.";
    assert.equal(friendlyApiError(409, locked), locked);
    const none = "Judging is not finalized, so there is nothing to reopen.";
    assert.equal(friendlyApiError(409, none), none);
  });
});
