import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { JudgeServiceError } from "@/lib/judges";

/**
 * Organizer accounts: change your own password, add organizers, enable/disable.
 *
 * Organizers are ordinary `User` rows with role ORGANIZER — same table, same
 * NextAuth credentials login, same bcrypt hashing as judges. There is no
 * self sign-up: only a signed-in organizer can create another one, and the role
 * is fixed by the server (a `role` field in a request is rejected).
 *
 * Lock-out protection: you cannot disable yourself, and the last active
 * organizer can never be disabled (checked up front for a clear message, and
 * enforced again inside one serialized transaction so two organizers disabling
 * each other at the same moment cannot lock everyone out).
 *
 * `db` is injected so the logic can be tested with an in-memory fake.
 */

export type OrganizerDb = Pick<PrismaClient, "user" | "$transaction" | "$queryRaw">;

/** Same cost factor as prisma/seed.ts and the judge accounts. */
const BCRYPT_ROUNDS = 10;
/** Postgres advisory lock key serializing organizer-disable operations. */
const ORGANIZER_LOCK_KEY = Prisma.raw("734201907");

export const ORGANIZER_SELECT = { id: true, name: true, email: true, active: true, createdAt: true } as const;
export type OrganizerSummary = Prisma.UserGetPayload<{ select: typeof ORGANIZER_SELECT }>;

const email = z.string().trim().toLowerCase().email("enter a valid email").max(200);
const newPassword = z.string().min(8, "password must be at least 8 characters").max(200);

export const organizerCreateInput = z
  .object({ name: z.string().trim().min(1, "name is required").max(200), email, password: newPassword })
  .strict();

export const organizerActiveInput = z.object({ active: z.boolean() }).strict();

export const passwordChangeInput = z
  .object({ currentPassword: z.string().min(1, "enter your current password").max(200), newPassword })
  .strict();

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Active organizers other than `exceptId`. */
const otherActiveOrganizers = (db: Pick<PrismaClient, "user">, exceptId: string) =>
  db.user.count({ where: { role: "ORGANIZER", active: true, NOT: { id: exceptId } } });

export async function listOrganizers(db: OrganizerDb): Promise<OrganizerSummary[]> {
  return db.user.findMany({
    where: { role: "ORGANIZER" },
    orderBy: [{ active: "desc" }, { name: "asc" }, { email: "asc" }],
    select: ORGANIZER_SELECT,
  });
}

export async function createOrganizer(db: OrganizerDb, input: z.input<typeof organizerCreateInput>): Promise<OrganizerSummary> {
  const data = organizerCreateInput.parse(input);
  const existing = await db.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) throw new JudgeServiceError(409, `An account with email "${data.email}" already exists`);

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  try {
    return await db.user.create({
      data: { name: data.name, email: data.email, passwordHash, role: "ORGANIZER", active: true },
      select: ORGANIZER_SELECT,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new JudgeServiceError(409, `An account with email "${data.email}" already exists`);
    throw e;
  }
}

/** Enable or disable another organizer. Never yourself, never the last active one. */
export async function setOrganizerActive(
  db: OrganizerDb,
  actorId: string,
  targetId: string,
  input: z.input<typeof organizerActiveInput>,
): Promise<OrganizerSummary> {
  const { active } = organizerActiveInput.parse(input);
  const target = await db.user.findFirst({ where: { id: targetId, role: "ORGANIZER" }, select: ORGANIZER_SELECT });
  if (!target) throw new JudgeServiceError(404, "Organizer not found");
  if (target.active === active) return target;

  if (!active) {
    if (targetId === actorId) throw new JudgeServiceError(409, "You can't disable your own account.");
    if ((await otherActiveOrganizers(db, targetId)) === 0) {
      throw new JudgeServiceError(409, "This is the last active organizer, so it can't be disabled.");
    }
    try {
      // One transaction: serialize, re-check the last-organizer rule, then disable.
      // Casting the text 'LAST_ACTIVE_ORGANIZER' to integer raises (aborting the whole
      // transaction) only when no other active organizer remains.
      await db.$transaction([
        db.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(${ORGANIZER_LOCK_KEY})`,
        db.$queryRaw`SELECT CAST(CASE WHEN EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ORGANIZER' AND "active" AND "id" <> ${targetId}) THEN '0' ELSE 'LAST_ACTIVE_ORGANIZER' END AS integer) AS ok`,
        db.user.updateMany({ where: { id: targetId, role: "ORGANIZER" }, data: { active: false } }),
      ]);
    } catch (e) {
      if ((await otherActiveOrganizers(db, targetId)) === 0) {
        throw new JudgeServiceError(409, "This is the last active organizer, so it can't be disabled.");
      }
      throw e;
    }
  } else {
    await db.user.updateMany({ where: { id: targetId, role: "ORGANIZER" }, data: { active: true } });
  }
  return (await db.user.findFirst({ where: { id: targetId }, select: ORGANIZER_SELECT }))!;
}

/**
 * Change the signed-in organizer's own password. Requires the current password
 * (so a hijacked session alone can't take over the account) and a different new one.
 */
export async function changeOwnPassword(db: OrganizerDb, userId: string, input: z.input<typeof passwordChangeInput>) {
  const { currentPassword, newPassword: next } = passwordChangeInput.parse(input);
  const user = await db.user.findFirst({ where: { id: userId, role: "ORGANIZER", active: true }, select: { id: true, passwordHash: true } });
  if (!user) throw new JudgeServiceError(404, "Account not found");

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new JudgeServiceError(400, "Your current password is incorrect.");
  }
  if (currentPassword === next) throw new JudgeServiceError(400, "The new password must be different from the current one.");

  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(next, BCRYPT_ROUNDS) } });
}

/** The organizer if the account still exists and is active — used to reject disabled organizers' live sessions. */
export async function getActiveOrganizer(db: Pick<PrismaClient, "user">, userId: string) {
  return db.user.findFirst({ where: { id: userId, role: "ORGANIZER", active: true }, select: { id: true } });
}
