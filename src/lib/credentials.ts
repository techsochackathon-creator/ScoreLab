import bcrypt from "bcryptjs";
import type { PrismaClient, User } from "@prisma/client";

export { ACCOUNT_DISABLED } from "@/lib/roles";

export type CredentialResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "disabled" };

/**
 * Email + password check used by the NextAuth credentials provider.
 * The password is verified BEFORE the active flag, so "disabled" is only
 * revealed to someone who already knows the correct password.
 */
export async function verifyCredentials(
  db: Pick<PrismaClient, "user">,
  email: string,
  password: string,
): Promise<CredentialResult> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return { ok: false, reason: "invalid" };

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { ok: false, reason: "invalid" };

  if (!user.active) return { ok: false, reason: "disabled" };
  return { ok: true, user };
}
