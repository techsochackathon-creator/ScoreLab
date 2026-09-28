import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { Session } from "next-auth";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkRole } from "@/lib/roles";
import { getActiveJudge } from "@/lib/judges";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Throws HttpError(401/403) unless the caller is a signed-in organizer. */
export async function requireOrganizer(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new HttpError(401, "Not authenticated");
  if (session.user.role !== "ORGANIZER") {
    throw new HttpError(403, "Organizer access required");
  }
  return session;
}

/** Throws HttpError(401/403) unless the caller is signed in with exactly `role`. */
export async function requireRole(role: Role): Promise<Session> {
  const session = await getServerSession(authOptions);
  const check = checkRole(session?.user, role);
  if (!check.ok) {
    throw new HttpError(
      check.status,
      check.status === 401 ? "Not authenticated" : `${role.charAt(0)}${role.slice(1).toLowerCase()} access required`,
    );
  }
  return session!;
}

/**
 * Throws HttpError(401/403) unless the caller is a signed-in, still-active judge.
 * The active flag is re-read from the DB on every call: sessions are JWTs, so a
 * judge disabled mid-session still holds a valid token until it expires.
 * Returns the judge — use its id, never a judgeId from the client.
 */
export async function requireJudge(): Promise<{ id: string; name: string | null; email: string }> {
  const session = await requireRole("JUDGE");
  const judge = await getActiveJudge(prisma, session.user.id);
  if (!judge) throw new HttpError(403, "Judge account is disabled");
  return judge;
}
