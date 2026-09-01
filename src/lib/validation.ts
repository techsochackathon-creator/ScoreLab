import { z } from "zod";
import { parse as parseYaml } from "yaml";

/**
 * Shared Zod schemas for the submission flow.
 *
 * The pitch deck is uploaded directly to Vercel Blob from the browser (client
 * upload), so by the time the submission payload reaches the server it carries
 * a `pitchDeckBlobUrl` string rather than a file.
 */

const envVarSchema = z.object({
  key: z
    .string()
    .min(1, "env var name is required")
    .regex(/^[A-Z_][A-Z0-9_]*$/i, "env var names must be alphanumeric/underscore"),
  value: z.string().optional().default(""),
  required: z.boolean().optional().default(false),
});

export const manifestSchema = z.object({
  installCommand: z.string().min(1, "installCommand is required"),
  runCommand: z.string().min(1, "runCommand is required"),
  port: z
    .number({ invalid_type_error: "port must be a number" })
    .int("port must be an integer")
    .min(1)
    .max(65535),
  env: z
    .union([z.array(envVarSchema), z.record(z.string(), z.string())])
    .optional()
    .default([])
    .transform((env) => {
      if (Array.isArray(env)) return env;
      return Object.entries(env).map(([key, value]) => ({
        key,
        value,
        required: false,
      }));
    }),
  notes: z.string().optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;

export function parseManifestYaml(raw: string): Manifest {
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    throw new Error(`manifest.yaml is not valid YAML: ${(e as Error).message}`);
  }
  if (doc === null || typeof doc !== "object") {
    throw new Error("manifest.yaml must be a YAML mapping (key: value pairs)");
  }
  return manifestSchema.parse(doc);
}

// URL helpers ---------------------------------------------------------------

const httpUrl = z
  .string()
  .trim()
  .url("must be a valid URL")
  .refine((u) => /^https?:\/\//i.test(u), "must start with http:// or https://");

export const repoUrlSchema = httpUrl.refine(
  (u) => /github\.com|gitlab\.com|bitbucket\.org/i.test(u),
  "repo URL should point to GitHub, GitLab, or Bitbucket",
);

const optionalHttpUrl = z
  .union([httpUrl, z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));

/** Vercel Blob public URLs live on *.public.blob.vercel-storage.com. */
export const blobUrlSchema = z
  .union([
    httpUrl.refine(
      (u) => {
        try {
          return new URL(u).hostname.endsWith(".public.blob.vercel-storage.com");
        } catch {
          return false;
        }
      },
      "pitch deck must be a Vercel Blob URL",
    ),
    z.literal(""),
  ])
  .optional()
  .transform((v) => (v ? v : undefined));

/** JSON payload accepted by POST /api/submissions. */
export const submissionInputSchema = z.object({
  repoUrl: repoUrlSchema,
  liveUrl: optionalHttpUrl,
  manifestYaml: z.string().min(1, "manifest.yaml is required"),
  pitchDeckBlobUrl: blobUrlSchema,
});

export type SubmissionInput = z.infer<typeof submissionInputSchema>;

/** Content types allowed for pitch-deck uploads (PDF / PPT / PPTX). */
export const ALLOWED_DECK_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
] as const;

export const MAX_DECK_BYTES = 25 * 1024 * 1024; // 25 MB
