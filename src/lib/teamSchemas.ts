import { z } from "zod";

/**
 * Team create/update input, shared by POST /api/teams and PUT /api/teams/[id].
 *
 * The team form only asks for code, name, repo URL, project name and members.
 * `university` and `track` still exist on Team (and on older teams / CSV imports)
 * but are optional here:
 *   - create: university defaults to "" and track to "General"
 *   - update: omitted → left unchanged (never blanked by a form that doesn't show them);
 *     the same goes for members/technologies when not sent
 * `repoUrl` is stored (the AI batch evaluation needs it); empty/null clears it.
 */
const repoUrl = z
  .union([z.literal(""), z.string().trim().url("enter a valid repository URL").max(500)])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const base = {
  teamCode: z.string().trim().min(1, "team code is required").max(64),
  name: z.string().trim().min(1, "name is required").max(200),
  memberNames: z.array(z.string().trim().min(1)).default([]),
  projectTitle: z.string().trim().max(200).optional().nullable(),
  projectDescription: z.string().trim().max(2000).optional().nullable(),
  technologies: z.array(z.string().trim().min(1)).default([]),
  repoUrl,
};

export const teamCreateInput = z.object({
  ...base,
  university: z.string().trim().max(200).default(""),
  track: z.string().trim().max(100).default("General").transform((v) => v || "General"),
});

export const teamUpdateInput = z.object({
  ...base,
  // Anything not sent is left unchanged (no defaults on update, so a partial form can't blank fields).
  memberNames: z.array(z.string().trim().min(1)).optional(),
  technologies: z.array(z.string().trim().min(1)).optional(),
  university: z.string().trim().max(200).optional(),
  track: z.string().trim().max(100).optional(),
});

/** First human-readable field message from a zod error, e.g. "repoUrl: enter a valid repository URL". */
export function firstFieldError(fieldErrors: Record<string, string[] | undefined> | undefined): string | null {
  for (const [field, msgs] of Object.entries(fieldErrors ?? {})) if (msgs?.[0]) return `${field}: ${msgs[0]}`;
  return null;
}
