import { Sandbox } from "e2b";
import type { ResolvedManifest, ViewportResult, AuthorshipMetric } from "./types";
import { manifestSchema } from "@/lib/validation";
import { parse as parseYaml } from "yaml";

/**
 * Thin wrapper around the E2B SDK. All E2B calls funnel through here so that
 * SDK API changes only need fixing in one place.
 *
 * Requires E2B_API_KEY. E2B_TEMPLATE should point to a sandbox template that
 * has git, node, and Playwright browsers installed (see README / e2b.Dockerfile).
 */

const TEMPLATE = process.env.E2B_TEMPLATE || "base";
const REPO_DIR = "/home/user/repo";
const SANDBOX_TIMEOUT_MS = 20 * 60 * 1000; // self-destruct guard for orphans
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const START_HEALTHCHECK_MS = 2 * 60 * 1000;

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Run a command, returning exit code/output even when the command fails. */
async function runSafe(
  sbx: Sandbox,
  cmd: string,
  opts: { timeoutMs?: number; cwd?: string; envs?: Record<string, string> } = {},
): Promise<RunResult> {
  try {
    const r = await sbx.commands.run(cmd, {
      timeoutMs: opts.timeoutMs ?? 60_000,
      cwd: opts.cwd,
      envs: opts.envs,
    });
    return { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } catch (e) {
    const err = e as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: err.exitCode ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? String(e),
    };
  }
}

const tail = (s: string, n = 4000) => (s.length > n ? s.slice(-n) : s);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function createSandbox(meta: {
  jobId: string;
}): Promise<{ sandboxId: string }> {
  const sbx = await Sandbox.create(TEMPLATE, {
    timeoutMs: SANDBOX_TIMEOUT_MS,
    metadata: { jobId: meta.jobId },
  });
  return { sandboxId: sbx.sandboxId };
}

export async function connectSandbox(sandboxId: string): Promise<Sandbox> {
  const sbx = await Sandbox.connect(sandboxId);
  // Extend the guard timeout each time we reconnect for a new step.
  try {
    await sbx.setTimeout(SANDBOX_TIMEOUT_MS);
  } catch {
    /* older SDKs may not expose setTimeout; the create-time guard still holds */
  }
  return sbx;
}

export async function killSandbox(sandboxId: string): Promise<void> {
  try {
    const sbx = await Sandbox.connect(sandboxId);
    await sbx.kill();
  } catch {
    /* already gone / timed out — nothing to do */
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export async function cloneRepo(sbx: Sandbox, repoUrl: string): Promise<RunResult> {
  await runSafe(sbx, `rm -rf ${REPO_DIR}`);
  return runSafe(
    sbx,
    `git clone --depth 100 ${shellQuote(repoUrl)} ${REPO_DIR}`,
    { timeoutMs: 3 * 60_000 },
  );
}

/** Read manifest.yaml/json from the repo, else fall back to the stored one. */
export async function readManifest(
  sbx: Sandbox,
  fallback: unknown,
): Promise<ResolvedManifest> {
  const tryFile = async (path: string): Promise<string | null> => {
    try {
      return (await sbx.files.read(`${REPO_DIR}/${path}`)) as string;
    } catch {
      return null;
    }
  };

  const yamlRaw = (await tryFile("manifest.yaml")) ?? (await tryFile("manifest.yml"));
  if (yamlRaw) {
    const parsed = manifestSchema.parse(parseYaml(yamlRaw));
    return finalizeManifest(parsed, "repo-yaml");
  }
  const jsonRaw = await tryFile("manifest.json");
  if (jsonRaw) {
    const parsed = manifestSchema.parse(JSON.parse(jsonRaw));
    return finalizeManifest(parsed, "repo-json");
  }
  // Fallback: the manifest validated at submission time (stored as JSON).
  const parsed = manifestSchema.parse(fallback);
  return finalizeManifest(parsed, "submission");
}

function finalizeManifest(
  m: { installCommand: string; runCommand: string; port: number; env: { key: string; value?: string }[] },
  source: ResolvedManifest["source"],
): ResolvedManifest {
  const env: Record<string, string> = {};
  for (const e of m.env ?? []) if (e.value) env[e.key] = e.value;
  return {
    installCommand: m.installCommand,
    runCommand: m.runCommand,
    port: m.port,
    env,
    source,
  };
}

export async function runInstall(
  sbx: Sandbox,
  installCommand: string,
  envs: Record<string, string>,
): Promise<{ exitCode: number; logsTail: string }> {
  const r = await runSafe(sbx, installCommand, {
    cwd: REPO_DIR,
    envs,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  return { exitCode: r.exitCode, logsTail: tail(r.stdout + "\n" + r.stderr) };
}

/** Start the server in the background and poll the port until reachable. */
export async function startServer(
  sbx: Sandbox,
  runCommand: string,
  port: number,
  envs: Record<string, string>,
): Promise<{ reachable: boolean; httpCode: number | null; logsTail: string }> {
  const logPath = "/tmp/server.log";
  // Detached: keeps running in the sandbox across Inngest step boundaries.
  await runSafe(
    sbx,
    `bash -lc 'cd ${REPO_DIR} && nohup ${runCommand} > ${logPath} 2>&1 &'`,
    { envs, timeoutMs: 30_000 },
  );

  const deadline = Date.now() + START_HEALTHCHECK_MS;
  let httpCode: number | null = null;
  while (Date.now() < deadline) {
    const probe = await runSafe(
      sbx,
      `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port}`,
      { timeoutMs: 15_000 },
    );
    const code = parseInt(probe.stdout.trim(), 10);
    if (!Number.isNaN(code) && code !== 0) {
      httpCode = code;
      break;
    }
    await sleep(3000);
  }

  const log = await runSafe(sbx, `tail -c 4000 ${logPath} 2>/dev/null || true`);
  return {
    reachable: httpCode != null,
    httpCode,
    logsTail: tail(log.stdout),
  };
}

/** Run Playwright INSIDE the sandbox at the given widths; screenshots to /tmp. */
export async function captureResponsiveness(
  sbx: Sandbox,
  port: number,
  widths: number[],
): Promise<Omit<ViewportResult, "blobUrl">[]> {
  await sbx.files.write("/tmp/shot.js", PLAYWRIGHT_SCRIPT);
  const r = await runSafe(sbx, "node /tmp/shot.js", {
    timeoutMs: 2 * 60_000,
    envs: {
      TARGET_URL: `http://localhost:${port}`,
      WIDTHS: JSON.stringify(widths),
    },
  });
  const marker = "RESULT_JSON:";
  const line = r.stdout.split("\n").find((l) => l.startsWith(marker));
  if (!line) {
    // Browser missing or crashed — report all viewports as failed.
    return widths.map((w) => ({ width: w, status: null, overflow: false, ok: false }));
  }
  try {
    return JSON.parse(line.slice(marker.length)) as Omit<ViewportResult, "blobUrl">[];
  } catch {
    return widths.map((w) => ({ width: w, status: null, overflow: false, ok: false }));
  }
}

export async function readFileBytes(sbx: Sandbox, path: string): Promise<Uint8Array> {
  return (await sbx.files.read(path, { format: "bytes" })) as Uint8Array;
}

export async function runCodeQuality(sbx: Sandbox): Promise<{
  readme: boolean;
  tests: boolean;
  authorship: AuthorshipMetric;
}> {
  const readme = await runSafe(
    sbx,
    `bash -lc 'cd ${REPO_DIR}; ls -1a | grep -qiE "^readme" && echo yes || echo no'`,
  );
  const tests = await runSafe(
    sbx,
    `bash -lc 'cd ${REPO_DIR}; { ls -d tests test __tests__ spec 2>/dev/null; git ls-files 2>/dev/null | grep -iE "(\\.(test|spec)\\.|(^|/)(tests?|__tests__)/)"; } | grep -q . && echo yes || echo no'`,
  );
  const authors = await runSafe(
    sbx,
    `bash -lc 'cd ${REPO_DIR}; git log --format=%ae 2>/dev/null'`,
    { timeoutMs: 60_000 },
  );

  const emails = authors.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const perAuthor: Record<string, number> = {};
  for (const e of emails) perAuthor[e] = (perAuthor[e] ?? 0) + 1;
  const counts = Object.values(perAuthor);

  return {
    readme: readme.stdout.trim() === "yes",
    tests: tests.stdout.trim() === "yes",
    authorship: {
      totalCommits: emails.length,
      authors: counts.length,
      perAuthor,
      minCommits: counts.length ? Math.min(...counts) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Minimal shell single-quote escaping for URLs passed to git clone. */
function shellQuote(s: string) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// Playwright script executed inside the sandbox (Node). Prints RESULT_JSON:<...>.
const PLAYWRIGHT_SCRIPT = `
const { chromium } = require('playwright');
(async () => {
  const url = process.env.TARGET_URL;
  const widths = JSON.parse(process.env.WIDTHS || '[375,768,1440]');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    let status = null, loaded = true;
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      status = resp ? resp.status() : null;
    } catch (e) { loaded = false; }
    let overflow = false;
    try {
      overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    } catch (e) {}
    const path = '/tmp/shot-' + w + '.png';
    let shot = true;
    try { await page.screenshot({ path, fullPage: true }); } catch (e) { shot = false; }
    const ok = !!(loaded && status && status < 400 && !overflow && shot);
    results.push({ width: w, status, overflow, ok });
    await ctx.close();
  }
  await browser.close();
  console.log('RESULT_JSON:' + JSON.stringify(results));
})().catch((e) => { console.error(e); console.log('RESULT_JSON:[]'); process.exit(0); });
`;
