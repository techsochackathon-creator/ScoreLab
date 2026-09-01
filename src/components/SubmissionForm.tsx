"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import {
  ALLOWED_DECK_TYPES,
  MAX_DECK_BYTES,
  parseManifestYaml,
  repoUrlSchema,
} from "@/lib/validation";

const MANIFEST_TEMPLATE = `# manifest.yaml — tells the evaluator how to build & run your project
installCommand: npm install
runCommand: npm run start
port: 3000
env:
  - key: NODE_ENV
    value: production
    required: true
  - key: DATABASE_URL
    required: true
notes: |
  Anything the judges should know before running.
`;

type FieldErrors = Record<string, string[] | undefined>;

export function SubmissionForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [manifestYaml, setManifestYaml] = useState(MANIFEST_TEMPLATE);
  const [deck, setDeck] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<string | null>(null);

  function chooseDeck(file: File | null) {
    setDeckError(null);
    setDeck(null);
    if (!file) return;
    if (file.size > MAX_DECK_BYTES) {
      setDeckError("Pitch deck exceeds the 25 MB limit.");
      return;
    }
    if (file.type && !ALLOWED_DECK_TYPES.includes(file.type as never)) {
      setDeckError("Pitch deck must be a PDF or PowerPoint file.");
      return;
    }
    setDeck(file);
  }

  function validateClient(): boolean {
    const next: FieldErrors = {};

    const repo = repoUrlSchema.safeParse(repoUrl.trim());
    if (!repo.success) next.repoUrl = repo.error.issues.map((i) => i.message);

    if (liveUrl.trim() && !/^https?:\/\/.+/i.test(liveUrl.trim())) {
      next.liveUrl = ["Live URL must start with http:// or https://"];
    }
    setErrors(next);

    try {
      parseManifestYaml(manifestYaml);
      setManifestError(null);
    } catch (e) {
      setManifestError((e as Error).message);
      return false;
    }

    return Object.keys(next).length === 0 && !deckError;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDone(null);
    if (!validateClient()) return;

    let pitchDeckBlobUrl: string | undefined;

    try {
      // 1) Upload the pitch deck straight to Vercel Blob (bypasses the 4.5 MB
      //    serverless body limit) and get back its public URL.
      if (deck) {
        setPhase("uploading");
        setProgress(0);
        const blob = await upload(deck.name, deck, {
          access: "public",
          handleUploadUrl: "/api/upload",
          contentType: deck.type || "application/octet-stream",
          onUploadProgress: (p) => setProgress(Math.round(p.percentage)),
        });
        pitchDeckBlobUrl = blob.url;
      }

      // 2) Persist the submission (JSON) with the blob URL.
      setPhase("saving");
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          liveUrl: liveUrl.trim(),
          manifestYaml,
          pitchDeckBlobUrl,
        }),
      });

      if (res.status === 201) {
        const data = await res.json();
        setDone(data.id);
        router.refresh();
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data.details && typeof data.details === "object") {
        setErrors(data.details as FieldErrors);
        if (data.details.env) setManifestError(JSON.stringify(data.details));
      } else if (data.error) {
        setManifestError(data.error);
      }
    } catch (err) {
      setDeckError(`Upload failed: ${(err as Error).message}`);
    } finally {
      setPhase("idle");
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950">
        <h2 className="font-semibold text-green-800 dark:text-green-300">
          Submission received ✔
        </h2>
        <p className="mt-1 text-sm text-green-700 dark:text-green-400">
          Submission ID: <code>{done}</code>. Organizers can now queue an
          evaluation job.
        </p>
        <button
          onClick={() => {
            setDone(null);
            setDeck(null);
            if (fileRef.current) fileRef.current.value = "";
          }}
          className="mt-4 text-sm font-medium text-green-800 underline dark:text-green-300"
        >
          Submit another
        </button>
      </div>
    );
  }

  const busy = phase !== "idle";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <Field label="Repository URL" required error={errors.repoUrl}>
        <input
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/team/project"
          className={inputCls(errors.repoUrl)}
        />
      </Field>

      <Field label="Live URL" error={errors.liveUrl} hint="Optional">
        <input
          type="url"
          value={liveUrl}
          onChange={(e) => setLiveUrl(e.target.value)}
          placeholder="https://myproject.vercel.app"
          className={inputCls(errors.liveUrl)}
        />
      </Field>

      <Field
        label="Pitch deck"
        hint="Optional · PDF or PPT/PPTX, max 25 MB"
        error={deckError ? [deckError] : undefined}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.ppt,.pptx,application/pdf"
          onChange={(e) => chooseDeck(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-white hover:file:bg-indigo-500"
        />
        {deck && (
          <p className="mt-1 text-xs text-gray-500">
            {deck.name} ({(deck.size / 1024 / 1024).toFixed(1)} MB)
          </p>
        )}
        {phase === "uploading" && (
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-800">
            <div
              className="h-full bg-indigo-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </Field>

      <Field
        label="manifest.yaml"
        required
        hint="install command · run command · port · env vars"
        error={manifestError ? [manifestError] : undefined}
      >
        <div className="mb-2 flex items-center gap-3">
          <label className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline">
            Upload .yaml
            <input
              type="file"
              accept=".yaml,.yml,text/yaml"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setManifestYaml(await f.text());
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setManifestYaml(MANIFEST_TEMPLATE);
              setManifestError(null);
            }}
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            Reset to template
          </button>
        </div>
        <textarea
          value={manifestYaml}
          onChange={(e) => setManifestYaml(e.target.value)}
          rows={14}
          spellCheck={false}
          className={`font-mono text-sm ${inputCls(
            manifestError ? [manifestError] : undefined,
          )}`}
        />
      </Field>

      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-lg bg-indigo-600 px-6 py-2.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {phase === "uploading"
          ? `Uploading deck… ${progress}%`
          : phase === "saving"
            ? "Submitting…"
            : "Submit project"}
      </button>
    </form>
  );
}

function inputCls(error?: string[]) {
  return `w-full rounded-md border px-3 py-2 dark:bg-gray-900 ${
    error
      ? "border-red-400 focus:border-red-500"
      : "border-gray-300 dark:border-gray-700"
  }`;
}

function Field({
  label,
  children,
  required,
  hint,
  error,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
  error?: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
      </div>
      {children}
      {error?.map((msg, i) => (
        <p key={i} className="text-xs text-red-600">
          {msg}
        </p>
      ))}
    </div>
  );
}
