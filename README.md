# Hackathon Evaluation System — Vercel edition

Next.js (App Router, TypeScript) app designed to deploy on **Vercel**, with
serverless Postgres (**Neon**), **NextAuth** organizer/team roles, and pitch-deck
uploads to **Vercel Blob**.

## Architecture

| Concern      | Choice |
| ------------ | ------ |
| Hosting      | Vercel (Next.js App Router) |
| DB           | Postgres (Neon) via Prisma. Pooled `POSTGRES_PRISMA_URL` at runtime, direct `POSTGRES_URL_NON_POOLING` for migrations. |
| Auth         | NextAuth (credentials), JWT sessions, `ORGANIZER` / `TEAM` roles; route gating in `src/middleware.ts`. |
| File uploads | Vercel Blob **client upload** (`/api/upload` mints a token; the browser streams the file directly to Blob, bypassing the 4.5 MB function-body limit). |
| Eval jobs    | `EvaluationJob` rows carry an `inngestRunId` for orchestration by [Inngest] (functions not included in this scaffold). |

### Why the pooled connection string (not `@prisma/adapter-neon`)

The default DB client (`src/lib/prisma.ts`) uses the standard **pooled Neon
connection string** — transaction-safe and free of driver/runtime caveats on
Vercel's Node runtime. If you specifically want the Neon serverless **driver
adapter** (e.g. for the edge runtime), the file documents the exact swap
(`@prisma/adapter-neon` + `@neondatabase/serverless` + `driverAdapters`
preview feature).

## Schema (`prisma/schema.prisma`)

`Team` · `Submission` (`repoUrl`, `liveUrl`, `pitchDeckBlobUrl`, `manifest` JSON)
· `Track` · `Rubric` → `RubricCriterion` (`checkType` enum, `weight`,
`scoringRules` JSON) · `EvaluationJob` (`submissionId`, `status`, `inngestRunId`,
`startedAt`, `completedAt`) · `CriterionResult` (`jobId`, `criterionId`,
`rawMetric`, `computedScore`, `details` JSON).

## Local development

```bash
npm install
```

Provide env vars in `.env.local` (see `.env.example`). If the storage is already
provisioned on Vercel, the easiest path is:

```bash
npx vercel link
npx vercel env pull .env.local   # pulls POSTGRES_* and BLOB_READ_WRITE_TOKEN
```

Then set up the DB and run:

```bash
npm run db:push        # or: npm run db:migrate:dev
npm run db:seed
npm run dev
```

### Demo logins (from seed)

| Role      | Email                 | Password     |
| --------- | --------------------- | ------------ |
| Organizer | organizer@example.com | organizer123 |
| Team      | team@example.com      | team123      |

Sign in as the team → **/submit**.

## Deploying to Vercel (standard integrations)

1. **Import the repo** into Vercel.
2. **Add Postgres (Neon):** Vercel dashboard → **Storage → Create Database →
   Neon/Postgres**, connect it to the project. This injects
   `POSTGRES_PRISMA_URL` and `POSTGRES_URL_NON_POOLING` (plus `POSTGRES_URL`
   etc.) as environment variables automatically.
3. **Add Blob:** **Storage → Create → Blob**, connect it. This injects
   `BLOB_READ_WRITE_TOKEN`.
4. **Add NextAuth vars:** set `NEXTAUTH_SECRET` (`openssl rand -base64 32`) and
   `NEXTAUTH_URL` (your deployment URL) in **Settings → Environment Variables**.
5. **Deploy.** The build runs `prisma generate && next build`. Run migrations
   against the DB once (`prisma migrate deploy` via `npm run db:migrate`, e.g.
   from CI or locally against the pulled env), then seed if desired.

## Submission flow

1. Team fills the form (`/submit`): repo URL, live URL, optional pitch deck,
   `manifest.yaml`.
2. The pitch deck uploads directly to Vercel Blob via `@vercel/blob/client`
   `upload()` → returns a public `*.public.blob.vercel-storage.com` URL.
3. The form POSTs JSON to `/api/submissions`, which re-validates everything
   server-side (`src/lib/validation.ts`: repo/live URLs, YAML manifest shape,
   Blob URL host) and stores the `Submission`.

## Rubric builder (`/organizer/rubrics`)

Organizer-only. One rubric per track; each criterion has a name, a checkType
dropdown, a weight (all weights must sum to 100%), and a **checkType-specific
scoring-rules UI**:

- `lighthouse_perf` / `lighthouse_a11y` — raw-score×weight **or** threshold bands
- `uptime` / `build_success` — pass/fail point values
- `responsiveness` — pick viewport widths + points per passing viewport
- `code_quality` — checklist of sub-checks (README, tests, min commits per
  teammate…), each with its own point value
- `human_score` — max judge score

Shared client/server validation in `src/lib/scoringRules.ts`. A track's rubric
**locks** once an `EvaluationJob` exists for it (or via the manual **Lock
rubric** button); locked rubrics are read-only and the save API returns `409`
(`src/lib/rubricLock.ts`). Weights are edited as percentages but persisted as
fractions in `RubricCriterion.weight`.

## Evaluation pipeline (Inngest + E2B)

Durable background evaluation lives in `src/inngest/functions/evaluateSubmission.ts`,
served at **`/api/inngest`** via the Inngest Next.js adapter. It is triggered by
the `evaluation/requested` event, emitted:

- automatically when a team submits (`POST /api/submissions`), and
- manually by an organizer (`POST /api/evaluations { submissionId }`).

Each stage is a retryable `step.run` that survives serverless timeouts:

| Step | What it does |
| ---- | ------------ |
| `load-submission` | Load submission + rubric criteria; mark job `RUNNING`, record `inngestRunId`. |
| `create-sandbox-clone` | Create an E2B sandbox (persist `sandboxId`), `git clone` the repo. |
| `read-manifest` | Read `manifest.yaml`/`.json` from the repo (falls back to the stored manifest). |
| `install` | Run the install command inside the sandbox (5-min command timeout). |
| `start-server` | Launch the run command detached, poll the port until reachable (2-min timeout). |
| `responsiveness` | Playwright **inside the sandbox** screenshots each configured viewport width, detects horizontal overflow, uploads PNGs to **Vercel Blob**. |
| `uptime-lighthouse` | Outside the sandbox: fetch `liveUrl` for uptime + run Lighthouse via the **PageSpeed Insights API** (perf + a11y). |
| `code-quality` | Inside the sandbox: README present? test files/dir? parse `git log` for commit authorship spread. |
| `persist-results` | Score every criterion (`src/lib/eval/score.ts`) → upsert `CriterionResult` rows; mark job `COMPLETED`. |
| `teardown-sandbox` | Kill the sandbox. |

**Sandbox teardown is guaranteed.** It runs on the success path *and* in the
function's `onFailure` handler (which reads `EvaluationJob.sandboxId`). It is
deliberately **not** in a per-attempt `finally` — that would kill a sandbox that
a retry still needs. As a backstop, sandboxes are created with a 20-minute
`timeoutMs` so any orphan self-destructs.

### Why these choices

- **Playwright runs inside the E2B sandbox**, not on Vercel — the serverless
  runtime has no browser. This needs a template with Chromium; see
  `e2b.Dockerfile` (build it, then set `E2B_TEMPLATE`).
- **Lighthouse runs via PageSpeed Insights** (remote), for the same reason.

### Running locally

```bash
# 1) Inngest dev server (discovers /api/inngest, runs functions locally)
npx inngest-cli@latest dev

# 2) the app
npm run dev
```

Set `E2B_API_KEY` (and ideally build the Playwright template). Submitting a
project — or `POST /api/evaluations` — will run the pipeline; watch it in the
Inngest dev dashboard.

> **Schema note:** this feature adds `EvaluationJob.sandboxId`. Run
> `npm run db:push` after pulling.

### Deploying on Vercel

Add the **Inngest** integration (syncs the `/api/inngest` endpoint and sets
`INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`), plus `E2B_API_KEY` and optionally
`PAGESPEED_API_KEY`. The `/api/inngest` route sets `maxDuration = 300`; ensure
your plan allows it (or lower it — Inngest still checkpoints between steps).

## Aggregation & leaderboard

Pure scoring logic in `src/lib/aggregation.ts` (no DB — unit-testable); DB
wiring in `src/lib/leaderboard.ts`; UI at **`/organizer/leaderboard`**.

**Per-criterion:** `norm = clamp(computedScore / maxPoints, 0, 1)` where
`maxPoints` comes from the criterion's `scoringRules` (`maxPointsFor()` in
`src/lib/scoringRules.ts`). Contribution = `weight × norm`.

**technicalScore (0–100):** automated criteria, rescaled so their weights fill
100 — always defined and comparable regardless of human scoring.

**humanScore:** an optional `Submission.humanScore` an organizer enters later
(inline on the leaderboard → `PUT /api/submissions/:id/human-score`), validated
against the rubric's `human_score` criterion `maxScore`.

**finalScore (0–100):**
- human score present → `100 × (Σ weightᵢ·normᵢ + humanWeight·humanNorm) / (autoWeight + humanWeight)`
- human score absent → falls back to `technicalScore` (human weight not applied)

Unmeasured criteria (e.g. no liveUrl → null Lighthouse) score 0 while keeping
their weight, so gaps cost points.

**Ranking** is per track (each team's latest submission, latest COMPLETED job),
with documented tie-breaks: **final score → performance → technical → accessibility
→ reliability (uptime+build) → earliest submission → team name/id**. Unevaluated
submissions rank last. See `compareEntries()` and the on-page "Tie-break rules".

> **Schema note:** adds `Submission.humanScore`. Run `npm run db:push` after pulling.

## Organizer dashboard

**`/organizer/dashboard`** (organizer-only) — per-track control center:

- **Job status** per team (queued / running / complete / failed) with live
  status counts, sourced from `EvaluationJob` rows the Inngest pipeline updates.
- **Scores** — final & technical per team; **re-run** a failed/stale evaluation
  (`POST /api/evaluations`); inline **judge-score** entry.
- **Publish & lock** (`POST`/`DELETE /api/tracks/[id]/publish`): sets
  `Track.publishedAt`, which **locks scores** (re-runs and judge edits return
  `423`) and exposes a **public leaderboard** at `/leaderboard/[trackId]`
  (no auth — renders only while published).

**`/organizer/submissions/[id]`** — full evidence view: job history (with
`inngestRunId` + errors), and per-criterion results including **build logs**,
**responsiveness screenshots served from Vercel Blob**, Lighthouse scores,
uptime, and code-quality sub-checks + authorship.

Data layer: `src/lib/dashboard.ts` (`getTrackDashboard`, `getSubmissionDetail`).
Logs/screenshots need no extra storage — they're read from `CriterionResult.details`.

> **Schema note:** adds `Track.publishedAt`. Run `npm run db:push` after pulling.

## Public / team-facing pages

No auth required (outside the middleware matcher):

- **`/leaderboard`** — index of published track leaderboards.
- **`/leaderboard/[trackId]`** — public per-track board (team, rank, final
  score); each row links to that team's results.
- **`/leaderboard/[trackId]/[teamId]`** — a team's **results page**: final &
  technical score plus a criterion-by-criterion breakdown with raw metrics
  (Lighthouse scores, uptime status…), build logs, and the responsiveness
  **screenshots from Vercel Blob** — so teams see exactly why they scored what
  they did. Visible when the track is published, or to an organizer, or to a
  member of that team (teams can review their own results pre-publication).
- **`/methodology`** — pulls live rubric criteria/weights/`scoringRules` from
  the DB and explains each check in plain language (`src/lib/methodology.ts`),
  so the published docs can never drift from the actual scoring config.

The criterion-evidence UI is one shared component
(`src/components/CriterionEvidence.tsx`) used by both the organizer detail view
and the public team-results page.

### Publishing = input locking, not a snapshot

Publishing freezes the *inputs* (no re-eval, no judge edits) rather than copying
scores into a snapshot table. Because inputs are frozen, live computation *is*
the frozen leaderboard — no scoring logic is duplicated and nothing can drift.
Unpublish to make changes, then re-publish.

[Inngest]: https://www.inngest.com/
