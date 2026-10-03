/**
 * Organizer accounts: add organizers, enable/disable, change own password.
 * In-memory stand-in for the Prisma calls the service makes — no real database.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  changeOwnPassword,
  createOrganizer,
  getActiveOrganizer,
  listOrganizers,
  setOrganizerActive,
  type OrganizerDb,
} from "../src/lib/organizers";
import { verifyCredentials } from "../src/lib/credentials";
import { JudgeServiceError } from "../src/lib/judges";

interface MUser { id: string; email: string; name: string | null; passwordHash: string; role: "ORGANIZER" | "JUDGE"; active: boolean; createdAt: Date }
type Where = { id?: string; email?: string; role?: string; active?: boolean; NOT?: { id: string } };

/** Like a PrismaPromise: the write runs only when awaited or executed by $transaction. */
const lazy = <T>(run: () => Promise<T>): Promise<T> => {
  let p: Promise<T> | undefined;
  const get = () => (p ??= run());
  return { then: (a, b) => get().then(a, b), catch: (b) => get().catch(b), finally: (f) => get().finally(f), [Symbol.toStringTag]: "Promise" } as Promise<T>;
};

function makeDb() {
  let seq = 0;
  const users: MUser[] = [];
  const hooks: { beforeTx?: () => void } = {};
  const match = (u: MUser, w: Where) =>
    (w.id === undefined || u.id === w.id) && (w.email === undefined || u.email === w.email) &&
    (w.role === undefined || u.role === w.role) && (w.active === undefined || u.active === w.active) &&
    (w.NOT === undefined || u.id !== w.NOT.id);
  const pickFields = (u: MUser, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((k) => [k, (u as unknown as Record<string, unknown>)[k]])) : { ...u };

  const db = {
    user: {
      findMany: async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => users.filter((u) => match(u, where)).map((u) => pickFields(u, select)),
      findFirst: async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
        const u = users.find((x) => match(x, where));
        return u ? pickFields(u, select) : null;
      },
      findUnique: async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
        const u = users.find((x) => match(x, where));
        return u ? pickFields(u, select) : null;
      },
      count: async ({ where }: { where: Where }) => users.filter((u) => match(u, where)).length,
      create: async ({ data, select }: { data: Omit<MUser, "id" | "createdAt">; select?: Record<string, boolean> }) => {
        if (users.some((u) => u.email === data.email)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" });
        const u: MUser = { id: `user_${++seq}`, createdAt: new Date(), ...data };
        users.push(u);
        return pickFields(u, select);
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<MUser> }) => Object.assign(users.find((u) => u.id === where.id)!, data),
      updateMany: ({ where, data }: { where: Where; data: Partial<MUser> }) => lazy(async () => {
        const hits = users.filter((u) => match(u, where));
        hits.forEach((u) => Object.assign(u, data));
        return { count: hits.length };
      }),
    },
    // Raw SQL: the advisory lock is a no-op; the guard raises exactly like the real cast when no other active organizer remains.
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => lazy(async () => {
      if (strings.join("?").includes("LAST_ACTIVE_ORGANIZER")) {
        const target = values[values.length - 1] as string;
        if (!users.some((u) => u.role === "ORGANIZER" && u.active && u.id !== target)) throw new Error('invalid input syntax for type integer: "LAST_ACTIVE_ORGANIZER"');
      }
      return [{ ok: 1 }];
    }),
    $transaction: async (ops: Promise<unknown>[]) => {
      hooks.beforeTx?.();
      const saved = structuredClone(users);
      try {
        const out: unknown[] = [];
        for (const op of ops) out.push(await op); // in order, like Postgres; first error aborts the batch
        return out;
      } catch (e) {
        users.forEach((u, i) => Object.assign(u, saved[i])); // roll back in place so held references stay valid
        throw e;
      }
    },
  };
  const add = async (email: string, role: "ORGANIZER" | "JUDGE", password: string, active = true) => {
    const u: MUser = { id: `user_${++seq}`, email, name: email.split("@")[0], passwordHash: await bcrypt.hash(password, 4), role, active, createdAt: new Date() };
    users.push(u);
    return u;
  };
  return { db: db as unknown as OrganizerDb, users, hooks, add };
}

async function rejects(p: Promise<unknown>, status: number, match?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof JudgeServiceError, `expected JudgeServiceError, got ${String(e)}`);
    assert.equal(e.status, status);
    if (match) assert.match(e.message, match);
    return true;
  });
}

const PW = "correct-horse-1";

describe("creating organizers", () => {
  it("creates an ORGANIZER with a bcrypt hash and no hash in the result; email is lower-cased", async () => {
    const t = makeDb();
    const o = await createOrganizer(t.db, { name: " Dana ", email: "Dana@Example.com", password: PW });
    assert.equal(o.email, "dana@example.com");
    assert.equal(o.name, "Dana");
    assert.equal(o.active, true);
    assert.equal("passwordHash" in o, false);
    const stored = t.users[0];
    assert.equal(stored.role, "ORGANIZER");
    assert.match(stored.passwordHash, /^\$2[aby]\$10\$/);
    assert.equal(await bcrypt.compare(PW, stored.passwordHash), true);
  });

  it("rejects a client-supplied role, short passwords, bad email, and duplicate email (incl. a judge's)", async () => {
    const t = makeDb();
    await assert.rejects(createOrganizer(t.db, { name: "x", email: "x@x.io", password: PW, role: "JUDGE" } as never), (e: unknown) => e instanceof Error && e.name === "ZodError");
    await assert.rejects(createOrganizer(t.db, { name: "x", email: "x@x.io", password: "short" }));
    await assert.rejects(createOrganizer(t.db, { name: "x", email: "nope", password: PW }));
    await t.add("j@x.io", "JUDGE", PW);
    await rejects(createOrganizer(t.db, { name: "x", email: "J@x.io", password: PW }), 409);
    assert.equal(t.users.length, 1);
  });

  it("lists only organizers", async () => {
    const t = makeDb();
    await t.add("o@x.io", "ORGANIZER", PW);
    await t.add("j@x.io", "JUDGE", PW);
    assert.deepEqual((await listOrganizers(t.db)).map((o) => o.email), ["o@x.io"]);
  });

  it("a new organizer can sign in", async () => {
    const t = makeDb();
    await createOrganizer(t.db, { name: "N", email: "n@x.io", password: PW });
    assert.equal((await verifyCredentials(t.db, "n@x.io", PW)).ok, true);
  });
});

describe("enabling / disabling organizers", () => {
  let t: ReturnType<typeof makeDb>;
  let a: MUser, b: MUser;
  beforeEach(async () => {
    t = makeDb();
    a = await t.add("a@x.io", "ORGANIZER", PW);
    b = await t.add("b@x.io", "ORGANIZER", PW);
  });

  it("can disable and re-enable another organizer; a disabled organizer cannot sign in", async () => {
    assert.equal((await setOrganizerActive(t.db, a.id, b.id, { active: false })).active, false);
    assert.deepEqual(await verifyCredentials(t.db, "b@x.io", PW), { ok: false, reason: "disabled" });
    assert.equal(await getActiveOrganizer(t.db, b.id), null, "live sessions of a disabled organizer are rejected");
    assert.equal((await setOrganizerActive(t.db, a.id, b.id, { active: true })).active, true);
    assert.equal((await verifyCredentials(t.db, "b@x.io", PW)).ok, true);
  });

  it("cannot disable yourself", async () => {
    await rejects(setOrganizerActive(t.db, a.id, a.id, { active: false }), 409, /own account/);
    assert.equal(a.active, true);
  });

  it("cannot disable the last active organizer", async () => {
    await setOrganizerActive(t.db, a.id, b.id, { active: false });
    // b is disabled, so a is the only active organizer; even another actor id can't disable it.
    await rejects(setOrganizerActive(t.db, b.id, a.id, { active: false }), 409, /last active organizer/);
    assert.equal(a.active, true);
  });

  it("race: if the other organizer is disabled between the check and the write, the guarded transaction still refuses", async () => {
    t.hooks.beforeTx = () => { b.active = false; }; // simulates a concurrent disable landing first
    await rejects(setOrganizerActive(t.db, b.id, a.id, { active: false }), 409, /last active organizer/);
    assert.equal(a.active, true, "nobody is locked out");
  });

  it("only acts on organizers (a judge id is 'not found'); unknown id is 404; extra fields rejected", async () => {
    const j = await t.add("j@x.io", "JUDGE", PW);
    await rejects(setOrganizerActive(t.db, a.id, j.id, { active: false }), 404);
    await rejects(setOrganizerActive(t.db, a.id, "nope", { active: false }), 404);
    await assert.rejects(setOrganizerActive(t.db, a.id, b.id, { active: false, role: "JUDGE" } as never));
    assert.equal(j.active, true);
    assert.equal(b.active, true);
  });

  it("getActiveOrganizer only accepts active organizers (not judges, not unknown ids)", async () => {
    const j = await t.add("j@x.io", "JUDGE", PW);
    assert.ok(await getActiveOrganizer(t.db, a.id));
    assert.equal(await getActiveOrganizer(t.db, j.id), null);
    assert.equal(await getActiveOrganizer(t.db, "nope"), null);
  });
});

describe("changing your own password", () => {
  it("requires the correct current password; the new one works and the old one stops working", async () => {
    const t = makeDb();
    const a = await t.add("a@x.io", "ORGANIZER", PW);
    await rejects(changeOwnPassword(t.db, a.id, { currentPassword: "wrong-password", newPassword: "brand-new-pass-9" }), 400, /current password is incorrect/);
    assert.equal(await bcrypt.compare(PW, a.passwordHash), true, "unchanged after a failed attempt");

    await changeOwnPassword(t.db, a.id, { currentPassword: PW, newPassword: "brand-new-pass-9" });
    assert.match(a.passwordHash, /^\$2[aby]\$10\$/);
    assert.equal((await verifyCredentials(t.db, "a@x.io", "brand-new-pass-9")).ok, true);
    assert.deepEqual(await verifyCredentials(t.db, "a@x.io", PW), { ok: false, reason: "invalid" });
  });

  it("rejects a too-short or unchanged new password, and extra fields (no user id can be supplied)", async () => {
    const t = makeDb();
    const a = await t.add("a@x.io", "ORGANIZER", PW);
    await assert.rejects(changeOwnPassword(t.db, a.id, { currentPassword: PW, newPassword: "short" }));
    await rejects(changeOwnPassword(t.db, a.id, { currentPassword: PW, newPassword: PW }), 400, /different/);
    await assert.rejects(changeOwnPassword(t.db, a.id, { currentPassword: PW, newPassword: "brand-new-pass-9", userId: "someone-else" } as never));
    assert.equal(await bcrypt.compare(PW, a.passwordHash), true);
  });

  it("only changes the signed-in account — other users are untouched; judges and disabled accounts can't use it", async () => {
    const t = makeDb();
    const a = await t.add("a@x.io", "ORGANIZER", PW);
    const b = await t.add("b@x.io", "ORGANIZER", PW);
    const j = await t.add("j@x.io", "JUDGE", PW);
    const off = await t.add("off@x.io", "ORGANIZER", PW, false);
    const bHash = b.passwordHash;
    await changeOwnPassword(t.db, a.id, { currentPassword: PW, newPassword: "brand-new-pass-9" });
    assert.equal(b.passwordHash, bHash);
    await rejects(changeOwnPassword(t.db, j.id, { currentPassword: PW, newPassword: "brand-new-pass-9" }), 404);
    await rejects(changeOwnPassword(t.db, off.id, { currentPassword: PW, newPassword: "brand-new-pass-9" }), 404);
  });
});
