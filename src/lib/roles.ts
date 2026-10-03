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

/** Route prefix → the only role allowed under it. */
export const PROTECTED_AREAS: { prefix: string; role: string }[] = [
  { prefix: "/organizer", role: "ORGANIZER" },
  { prefix: "/judge", role: "JUDGE" },
];

/**
 * Where to send `role` if it may not open `pathname`, or null if allowed.
 * A signed-in user of another role goes to their own area; anything else is forbidden.
 */
export function areaRedirect(pathname: string, role: string | null | undefined): string | null {
  const area = PROTECTED_AREAS.find((a) => pathname === a.prefix || pathname.startsWith(a.prefix + "/"));
  if (!area || role === area.role) return null;
  return homePathForRole(role) ?? "/login?error=forbidden";
}

/** Pure role check behind requireRole(): 401 when signed out, 403 for any other role. */
export function checkRole(
  user: { role?: string | null } | null | undefined,
  role: string,
): { ok: true } | { ok: false; status: 401 | 403 } {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== role) return { ok: false, status: 403 };
  return { ok: true };
}

/** Error code authorize() throws for a disabled account (shown on the login page). */
export const ACCOUNT_DISABLED = "AccountDisabled";
