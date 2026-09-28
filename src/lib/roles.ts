/**
 * Role → landing page. Plain strings (no Prisma import) so this is safe to use
 * from the edge middleware and client components as well as the server.
 */
export const ROLE_HOME: Record<string, string> = {
  ORGANIZER: "/organizer/dashboard",
  JUDGE: "/judge",
};

/** Landing page for a role, or null if the role has no area of its own. */
export function homePathForRole(role: string | null | undefined): string | null {
  return (role && ROLE_HOME[role]) || null;
}
