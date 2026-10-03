/**
 * Unit tests for judge accounts, assignments and role checks.
 *
 * Uses an in-memory stand-in for the Prisma client (only the calls the judge
 * service makes) — no real database. Covers:
 *   1. Role checks (organizer allowed, judge denied, signed-out denied) + route areas
 *   2. Judge creation (valid, duplicate email, hashed password, role forced to JUDGE)
 *   3. Credentials (disabled judge cannot log in; re-enabled can; organizers unaffected)
 *   4. Disable keeps assignments
 *   5. Assignments (create, duplicate, nonexistent judge/team, non-judge user, remove)
 *   6. Judge-scoped access (own team allowed, other judge's team denied)
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  assignTeams,
  assignmentCountForJudge,
  createJudge,
  getActiveJudge,
  getAssignedTeam,
  getJudge,
  JudgeServiceError,
  listAssignments,
  listJudges,
  removeAssignment,
  teamsForJudge,
  updateJudge,
  whileJudgingOpen,
  type JudgeDb,
} from "../src/lib/judges";
import { verifyCredentials } from "../src/lib/credentials";
import { areaRedirect, checkRole } from "../src/lib/roles";

// ---------------------------------------------------------------------------
// In-memory database
// ---------------------------------------------------------------------------

interface MUser { id: string; email: string; name: string | null; passwordHash: string; role: "ORGANIZER" | "JUDGE"; active: boolean; createdAt: Date; updatedAt: Date }
interface MTeam { id: string; teamCode: string; name: string; projectTitle: string | null }
interface MAssignment { id: string; judgeId: string; teamId: string; createdAt: Date }

type Sel = Record<string, unknown> | undefined;

function pick<T extends object>(obj: T, select: Sel): Record<string, unknown> {
  if (!select) return { ...obj } as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) if (v === true) out[k] = (obj as Record<string, unknown>)[k];
  return out;
}

function uniqueError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
}

/** Like a PrismaPromise: the write runs only when awaited or executed by $transaction. */
const lazy = <T>(run: () => Promise<T>): Promise<T> => {
  let p: Promise<T> | undefined;
  const get = () => (p ??= run());
  return { then: (a, b) => get().then(a, b), catch: (b) => get().catch(b), finally: (f) => get().finally(f), [Symbol.toStringTag]: "Promise" } as Promise<T>;
};

function makeDb() {
  let seq = 0;
  const id = (p: string) => `${p}_${++seq}`;
  const users: MUser[] = [];
  const teams: MTeam[] = [];
  const assignments: MAssignment[] = [];
  let finalized = false;
  const evaluations: { judgeId: string; teamId: string; status: "DRAFT" | "SUBMITTED" }[] = [];

  const matchUser = (u: MUser, w: Record<string, unknown>) =>
    (w.id === undefined || u.id === w.id) &&
    (w.role === undefined || u.role === w.role) &&
    (w.active === undefined || u.active === w.active) &&
    (w.email === undefined || u.email === w.email) &&
    (!(w.NOT as { id?: string } | undefined)?.id || u.id !== (w.NOT as { id: string }).id);

  const withCount = (u: MUser, select: Sel) => {
    const out = pick(u, select);
    if (select && "_count" in select) out._count = { judgeAssignments: assignments.filter((a) => a.judgeId === u.id).length };
    return out;
  };

  const assignmentView = (a: MAssignment, select: Sel) => {
    const out = pick(a, select);
    const teamSel = (select?.team as { select?: Sel } | undefined)?.select;
    if (teamSel) out.team = pick(teams.find((t) => t.id === a.teamId)!, teamSel);
    return out;
  };

  const matchAssignment = (a: MAssignment, w: Record<string, unknown>) => {
    const teamIn = (w.teamId as { in?: string[] } | undefined)?.in;
    return (
      (w.judgeId === undefined || a.judgeId === w.judgeId) &&
      (w.teamId === undefined || (teamIn ? teamIn.includes(a.teamId) : a.teamId === w.teamId))
    );
  };

  const db = {
    user: {
      findMany: async ({ where, select }: { where: Record<string, unknown>; select: Sel }) =>
        users.filter((u) => matchUser(u, where)).map((u) => withCount(u, select)),
      findFirst: async ({ where, select }: { where: Record<string, unknown>; select: Sel }) => {
        const u = users.find((x) => matchUser(x, where));
        return u ? withCount(u, select) : null;
      },
      findUnique: async ({ where, select }: { where: { email?: string; id?: string }; select?: Sel }) => {
        const u = users.find((x) => (where.email ? x.email === where.email : x.id === where.id));
        return u ? pick(u, select) : null;
      },
      create: ({ data, select }: { data: Omit<MUser, "id" | "createdAt" | "updatedAt">; select: Sel }) => lazy(async () => {
        if (users.some((u) => u.email === data.email)) throw uniqueError();
        const u: MUser = { id: id("user"), createdAt: new Date(), updatedAt: new Date(), ...data };
        users.push(u);
        return pick(u, select);
      }),
      update: async ({ where, data, select }: { where: { id: string }; data: Partial<MUser>; select: Sel }) => {
        const u = users.find((x) => x.id === where.id)!;
        if (data.email && users.some((x) => x.email === data.email && x.id !== u.id)) throw uniqueError();
        Object.assign(u, data, { updatedAt: new Date() });
        return pick(u, select);
      },
    },
    team: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        teams.filter((t) => where.id.in.includes(t.id)).map((t) => ({ id: t.id })),
    },
    judgeAssignment: {
      findMany: async ({ where, select, orderBy }: { where: Record<string, unknown>; select: Sel; orderBy?: unknown }) => {
        const code = (a: MAssignment) => teams.find((x) => x.id === a.teamId)!.teamCode;
        const rows = assignments.filter((a) => matchAssignment(a, where));
        if (orderBy) rows.sort((x, y) => code(x).localeCompare(code(y))); // only order used: team.teamCode asc
        return rows.map((a) => assignmentView(a, select));
      },
      findUnique: async ({ where, select }: { where: { judgeId_teamId: { judgeId: string; teamId: string } }; select: Sel }) => {
        const a = assignments.find((x) => x.judgeId === where.judgeId_teamId.judgeId && x.teamId === where.judgeId_teamId.teamId);
        return a ? assignmentView(a, select) : null;
      },
      create: ({ data }: { data: { judgeId: string; teamId: string } }) => lazy(async () => {
        if (assignments.some((a) => a.judgeId === data.judgeId && a.teamId === data.teamId)) throw uniqueError();
        const a = { id: id("asg"), createdAt: new Date(), ...data };
        assignments.push(a);
        return a;
      }),
      deleteMany: ({ where }: { where: Record<string, unknown> }) => lazy(async () => {
        const before = assignments.length;
        for (let i = assignments.length - 1; i >= 0; i--) if (matchAssignment(assignments[i], where)) assignments.splice(i, 1);
        return { count: before - assignments.length };
      }),
      count: async ({ where }: { where: Record<string, unknown> }) => assignments.filter((a) => matchAssignment(a, where)).length,
    },
    // Batch transaction, all-or-nothing like Postgres: restore state if any op fails.
    $transaction: async (ops: Promise<unknown>[]) => {
      const saved = [structuredClone(users), structuredClone(assignments)] as const;
      try {
        return await Promise.all(ops);
      } catch (e) {
        users.splice(0, users.length, ...saved[0]);
        assignments.splice(0, assignments.length, ...saved[1]);
        throw e;
      }
    },
    // whileJudgingOpen: lock is a no-op here; the guard fails once finalized (like the real SQL cast).
    $queryRaw: async (strings: TemplateStringsArray) => {
      if (strings.join("?").includes('"ResultsPublication"') && finalized) throw new Error("invalid input syntax for type integer: \"OFFICIAL:JUDGING_FINALIZED\"");
      return [{ ok: 1 }];
    },
    resultsPublication: { findFirst: async () => (finalized ? { id: "official" } : null) },
    judgeEvaluation: {
      findFirst: async ({ where }: { where: { judgeId: string; teamId: string } }) =>
        evaluations.find((e) => e.judgeId === where.judgeId && e.teamId === where.teamId) ? { id: "eval" } : null,
    },
  };

  const addTeam = (teamCode: string) => {
    const t: MTeam = { id: id("team"), teamCode, name: `Team ${teamCode}`, projectTitle: null };
    teams.push(t);
    return t;
  };
  const addOrganizer = async (email: string, password: string) => {
    const u: MUser = {
      id: id("user"), email, name: "Org", passwordHash: await bcrypt.hash(password, 4),
      role: "ORGANIZER", active: true, createdAt: new Date(), updatedAt: new Date(),
    };
    users.push(u);
    return u;
  };

  const finalize = () => { finalized = true; };
  const addEvaluation = (judgeId: string, teamId: string, status: "DRAFT" | "SUBMITTED") => evaluations.push({ judgeId, teamId, status });
  return { db: db as unknown as JudgeDb, users, teams, assignments, evaluations, addTeam, addOrganizer, finalize, addEvaluation };
}

async function rejects(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof JudgeServiceError, `expected JudgeServiceError, got ${String(e)}`);
    assert.equal(e.status, status);
    return true;
  });
}

const PW = "correct-horse-1";

// ---------------------------------------------------------------------------
// 1. Role checks
// ---------------------------------------------------------------------------

describe("role checks", () => {
  it("organizer API guard: ORGANIZER allowed, JUDGE 403, signed-out 401", () => {
    assert.deepEqual(checkRole({ role: "ORGANIZER" }, "ORGANIZER"), { ok: true });
    assert.deepEqual(checkRole({ role: "JUDGE" }, "ORGANIZER"), { ok: false, status: 403 });
    assert.deepEqual(checkRole(null, "ORGANIZER"), { ok: false, status: 401 });
  });

  it("judge API guard: JUDGE allowed, ORGANIZER 403, signed-out 401", () => {
    assert.deepEqual(checkRole({ role: "JUDGE" }, "JUDGE"), { ok: true });
    assert.deepEqual(checkRole({ role: "ORGANIZER" }, "JUDGE"), { ok: false, status: 403 });
    assert.deepEqual(checkRole(undefined, "JUDGE"), { ok: false, status: 401 });
  });

  it("route areas: each role is kept out of the other's pages", () => {
    assert.equal(areaRedirect("/organizer/judges", "ORGANIZER"), null);
    assert.equal(areaRedirect("/organizer/judges", "JUDGE"), "/judge");
    assert.equal(areaRedirect("/judge/teams/x", "JUDGE"), null);
    assert.equal(areaRedirect("/judge", "ORGANIZER"), "/organizer/dashboard");
    assert.equal(areaRedirect("/organizer", undefined), "/login?error=forbidden");
    assert.equal(areaRedirect("/judgement", "ORGANIZER"), null, "prefix must match a whole segment");
  });
});

// ---------------------------------------------------------------------------
// 2–4. Judge accounts + credentials
// ---------------------------------------------------------------------------

describe("judge accounts", () => {
  let t: ReturnType<typeof makeDb>;
  beforeEach(() => { t = makeDb(); });

  it("creates a valid judge with role JUDGE, active, and no passwordHash in the result", async () => {
    const j = await createJudge(t.db, { name: " Judge A ", email: "A@Example.com", password: PW });
    assert.equal(j.role, "JUDGE");
    assert.equal(j.active, true);
    assert.equal(j.email, "a@example.com");
    assert.equal(j.name, "Judge A");
    assert.equal("passwordHash" in j, false);
  });

  it("stores a bcrypt hash, never the plaintext password", async () => {
    await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    const stored = t.users[0].passwordHash;
    assert.notEqual(stored, PW);
    assert.match(stored, /^\$2[aby]\$10\$/);
    assert.equal(await bcrypt.compare(PW, stored), true);
  });

  it("rejects a client-supplied role (cannot create an ORGANIZER)", async () => {
    await assert.rejects(
      createJudge(t.db, { name: "A", email: "a@x.io", password: PW, role: "ORGANIZER" } as never),
      (e: unknown) => e instanceof Error && e.name === "ZodError",
    );
    assert.equal(t.users.length, 0);
  });

  it("rejects duplicate email, including an organizer's email", async () => {
    await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    await rejects(createJudge(t.db, { name: "B", email: "A@x.io", password: PW }), 409);
    await t.addOrganizer("org@x.io", PW);
    await rejects(createJudge(t.db, { name: "C", email: "org@x.io", password: PW }), 409);
  });

  it("rejects missing fields and short passwords", async () => {
    await assert.rejects(createJudge(t.db, { name: "", email: "a@x.io", password: PW }));
    await assert.rejects(createJudge(t.db, { name: "A", email: "not-an-email", password: PW }));
    await assert.rejects(createJudge(t.db, { name: "A", email: "a@x.io", password: "short" }));
  });

  it("organizer endpoints never act on organizer accounts", async () => {
    const org = await t.addOrganizer("org@x.io", PW);
    await rejects(getJudge(t.db, org.id), 404);
    await rejects(updateJudge(t.db, org.id, { active: false }), 404);
    assert.equal(org.active, true);
    assert.equal((await listJudges(t.db)).length, 0);
  });

  it("update cannot change role; email clash rejected; password reset re-hashes", async () => {
    const a = await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    await createJudge(t.db, { name: "B", email: "b@x.io", password: PW });
    await assert.rejects(updateJudge(t.db, a.id, { role: "ORGANIZER" } as never));
    await rejects(updateJudge(t.db, a.id, { email: "b@x.io" }), 409);
    await updateJudge(t.db, a.id, { password: "new-password-9" });
    const stored = t.users.find((u) => u.id === a.id)!;
    assert.equal(stored.role, "JUDGE");
    assert.equal(await bcrypt.compare("new-password-9", stored.passwordHash), true);
  });

  it("disabled judge cannot log in; re-enabled judge can; organizers unaffected", async () => {
    const a = await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    await t.addOrganizer("org@x.io", PW);

    assert.equal((await verifyCredentials(t.db, "a@x.io", PW)).ok, true);
    await updateJudge(t.db, a.id, { active: false });
    assert.deepEqual(await verifyCredentials(t.db, "a@x.io", PW), { ok: false, reason: "disabled" });
    assert.deepEqual(await verifyCredentials(t.db, "a@x.io", "wrong"), { ok: false, reason: "invalid" }, "wrong password never reveals 'disabled'");
    assert.equal(await getActiveJudge(t.db, a.id), null, "live sessions of a disabled judge are rejected");

    await updateJudge(t.db, a.id, { active: true });
    assert.equal((await verifyCredentials(t.db, "a@x.io", PW)).ok, true);
    assert.equal((await verifyCredentials(t.db, "ORG@x.io", PW)).ok, true);
  });

  it("disabling keeps the judge's assignments", async () => {
    const a = await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    const t1 = t.addTeam("TEAM-001");
    const t2 = t.addTeam("TEAM-002");
    await assignTeams(t.db, a.id, { teamIds: [t1.id, t2.id] });
    await updateJudge(t.db, a.id, { active: false });
    assert.equal(await assignmentCountForJudge(t.db, a.id), 2);
    assert.equal((await getJudge(t.db, a.id)).assignmentCount, 2);
  });
});

// ---------------------------------------------------------------------------
// 5. Assignments
// ---------------------------------------------------------------------------

describe("assignments", () => {
  let t: ReturnType<typeof makeDb>;
  let judgeId: string;
  beforeEach(async () => {
    t = makeDb();
    judgeId = (await createJudge(t.db, { name: "A", email: "a@x.io", password: PW })).id;
  });

  it("creates assignments and lists them by team code", async () => {
    const t2 = t.addTeam("TEAM-014");
    const t1 = t.addTeam("TEAM-001");
    const teams = await assignTeams(t.db, judgeId, { teamIds: [t2.id, t1.id] });
    assert.deepEqual(teams.map((x) => x.teamCode), ["TEAM-001", "TEAM-014"]);
    assert.equal((await listJudges(t.db))[0].assignmentCount, 2);
  });

  it("rejects a duplicate assignment without partial writes", async () => {
    const t1 = t.addTeam("TEAM-001");
    const t2 = t.addTeam("TEAM-002");
    await assignTeams(t.db, judgeId, { teamIds: [t1.id] });
    await rejects(assignTeams(t.db, judgeId, { teamIds: [t2.id, t1.id] }), 409);
    await rejects(assignTeams(t.db, judgeId, { teamIds: [t2.id, t2.id] }), 400);
    assert.equal(t.assignments.length, 1);
  });

  it("rejects nonexistent judge, organizer as judge, and nonexistent team", async () => {
    const t1 = t.addTeam("TEAM-001");
    await rejects(assignTeams(t.db, "nope", { teamIds: [t1.id] }), 404);
    const org = await t.addOrganizer("org@x.io", PW);
    await rejects(assignTeams(t.db, org.id, { teamIds: [t1.id] }), 404);
    await rejects(assignTeams(t.db, judgeId, { teamIds: [t1.id, "missing-team"] }), 404);
    assert.equal(t.assignments.length, 0);
  });

  it("assignments cannot be added or removed after judging is finalized", async () => {
    const t1 = t.addTeam("TEAM-001");
    const t2 = t.addTeam("TEAM-002");
    await assignTeams(t.db, judgeId, { teamIds: [t1.id] });
    t.finalize();
    await rejects(assignTeams(t.db, judgeId, { teamIds: [t2.id] }), 409);
    await rejects(removeAssignment(t.db, judgeId, t1.id), 409);
    assert.deepEqual(t.assignments.map((a) => a.teamId), [t1.id]);
  });

  it("guarded write is rejected if finalization lands after the pre-check (race path)", async () => {
    const t1 = t.addTeam("TEAM-001");
    t.finalize();
    // Call the guarded write directly, as if the pre-check had passed just before finalization.
    await rejects(whileJudgingOpen(t.db, [t.db.judgeAssignment.create({ data: { judgeId, teamId: t1.id } })]), 409);
    assert.equal(t.assignments.length, 0, "nothing written");
  });

  it("removes an assignment; removing a missing one is 404", async () => {
    const t1 = t.addTeam("TEAM-001");
    await assignTeams(t.db, judgeId, { teamIds: [t1.id] });
    await removeAssignment(t.db, judgeId, t1.id);
    assert.equal((await listAssignments(t.db, judgeId)).length, 0);
    await rejects(removeAssignment(t.db, judgeId, t1.id), 404);
  });
});

// ---------------------------------------------------------------------------
// 6. Judge-scoped access
// ---------------------------------------------------------------------------

describe("judge access is limited to assigned teams", () => {
  it("Judge A sees Team A, not Team B assigned to Judge B", async () => {
    const t = makeDb();
    const a = await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    const b = await createJudge(t.db, { name: "B", email: "b@x.io", password: PW });
    const teamA = t.addTeam("TEAM-001");
    const teamB = t.addTeam("TEAM-999");
    await assignTeams(t.db, a.id, { teamIds: [teamA.id] });
    await assignTeams(t.db, b.id, { teamIds: [teamB.id] });

    assert.equal((await getAssignedTeam(t.db, a.id, teamA.id))?.teamCode, "TEAM-001");
    assert.equal(await getAssignedTeam(t.db, a.id, teamB.id), null);
    assert.equal(await getAssignedTeam(t.db, a.id, "does-not-exist"), null);
    assert.deepEqual((await teamsForJudge(t.db, a.id)).map((x) => x.teamCode), ["TEAM-001"]);
    assert.deepEqual((await teamsForJudge(t.db, b.id)).map((x) => x.teamCode), ["TEAM-999"]);
  });

  it("session-derived judge identity only resolves active JUDGE users", async () => {
    const t = makeDb();
    const a = await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    const org = await t.addOrganizer("org@x.io", PW);
    assert.equal((await getActiveJudge(t.db, a.id))?.id, a.id);
    assert.equal(await getActiveJudge(t.db, org.id), null);
    assert.equal(await getActiveJudge(t.db, "unknown"), null);
  });
});

describe("Phase 7: assignment protection unchanged", () => {
  it("duplicates, non-judges and unknown teams are rejected; changes after finalization are 409", async () => {
    const t = makeDb();
    const judge = await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    const org = await t.addOrganizer("org@x.io", PW);
    const t1 = t.addTeam("TEAM-001");
    const t2 = t.addTeam("TEAM-002");

    await assignTeams(t.db, judge.id, { teamIds: [t1.id] });
    await rejects(assignTeams(t.db, judge.id, { teamIds: [t1.id] }), 409); // duplicate
    await rejects(assignTeams(t.db, org.id, { teamIds: [t2.id] }), 404); // organizer is not a judge
    await rejects(assignTeams(t.db, judge.id, { teamIds: ["nope"] }), 404);

    t.finalize();
    await rejects(assignTeams(t.db, judge.id, { teamIds: [t2.id] }), 409);
    await rejects(removeAssignment(t.db, judge.id, t1.id), 409);
    assert.deepEqual(t.assignments.map((a) => a.teamId), [t1.id]);
  });
});

describe("assignment removal once an evaluation exists", () => {
  it("allowed with no evaluation; 409 with a DRAFT or SUBMITTED evaluation; 409 after finalization", async () => {
    const t = makeDb();
    const judge = await createJudge(t.db, { name: "A", email: "a@x.io", password: PW });
    const [t1, t2, t3, t4] = ["TEAM-001", "TEAM-002", "TEAM-003", "TEAM-004"].map((c) => t.addTeam(c));
    await assignTeams(t.db, judge.id, { teamIds: [t1.id, t2.id, t3.id, t4.id] });

    // 1. no evaluation → removed
    await removeAssignment(t.db, judge.id, t1.id);
    assert.ok(!t.assignments.some((a) => a.teamId === t1.id));

    // 2. DRAFT evaluation → 409, assignment and evaluation kept
    t.addEvaluation(judge.id, t2.id, "DRAFT");
    await assert.rejects(removeAssignment(t.db, judge.id, t2.id), (e: unknown) =>
      e instanceof JudgeServiceError && e.status === 409 && /already started an evaluation/.test(e.message));

    // 3. SUBMITTED evaluation → 409
    t.addEvaluation(judge.id, t3.id, "SUBMITTED");
    await rejects(removeAssignment(t.db, judge.id, t3.id), 409);

    // Another judge's evaluation of the same team does not block this judge's removal.
    const other = await createJudge(t.db, { name: "B", email: "b@x.io", password: PW });
    await assignTeams(t.db, other.id, { teamIds: [t4.id] });
    t.addEvaluation(other.id, t4.id, "SUBMITTED");
    await removeAssignment(t.db, judge.id, t4.id);

    assert.deepEqual(t.assignments.filter((a) => a.judgeId === judge.id).map((a) => a.teamId).sort(), [t2.id, t3.id].sort());
    assert.equal(t.evaluations.length, 3, "evaluations untouched");

    // 4. after finalization → existing finalization 409 (even with no evaluation)
    await assignTeams(t.db, judge.id, { teamIds: [t1.id] });
    t.finalize();
    await assert.rejects(removeAssignment(t.db, judge.id, t1.id), (e: unknown) =>
      e instanceof JudgeServiceError && e.status === 409 && /finalized/.test(e.message));
    assert.ok(t.assignments.some((a) => a.judgeId === judge.id && a.teamId === t1.id));
  });
});
