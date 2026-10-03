/**
 * GitHub REST evidence fetcher — no cloning, no execution.
 *
 * Pulls README, file tree, a few key file contents, and commit/contributor
 * counts via the GitHub REST API. Set GITHUB_TOKEN to raise the rate limit
 * (60/hr unauthenticated → 5000/hr authenticated); the token is optional.
 */

const API = "https://api.github.com";

const README_MAX = 6000;
const FILE_MAX = 4000;
const TREE_MAX = 300;
const MAX_KEY_FILES = 5;

export interface KeyFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface RepoEvidence {
  owner: string;
  repo: string;
  description: string | null;
  defaultBranch: string;
  language: string | null;
  license: string | null;
  stars: number;
  pushedAt: string | null;
  readme: string | null;
  fileTree: string[];
  fileCount: number;
  keyFiles: KeyFile[];
  commitCount: number | null;
  contributorCount: number | null;
  /** SHA of the latest commit on the default branch, when available. */
  headSha: string | null;
}

export class GitHubError extends Error {}

/** Parse `owner` and `repo` from a GitHub URL (tolerates .git and trailing paths). */
export function parseRepoUrl(url: string): { owner: string; repo: string } {
  // Anchor to github.com specifically — reject look-alikes like evil-github.com.
  const m = url
    .trim()
    .match(/(?:^https?:\/\/(?:www\.)?|^)github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m) throw new GitHubError("Not a valid GitHub repository URL");
  return { owner: m[1], repo: m[2] };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "scorelab-evaluator",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh(path: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    headers: headers(),
    signal: AbortSignal.timeout(20_000),
  });
}

function decodeBase64(content: string): string {
  return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf-8");
}

/** Parse the last-page number from a paginated response's Link header. */
function lastPageFromLink(res: Response): number | null {
  const link = res.headers.get("link");
  if (!link) return res.ok ? 1 : null; // single page (or empty) when no Link header
  const m = link.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return m ? parseInt(m[1], 10) : 1;
}

const truncate = (s: string, n: number) =>
  s.length > n ? { text: s.slice(0, n), truncated: true } : { text: s, truncated: false };

/** Heuristic: pick a handful of interesting source files from the tree. */
function pickKeyFilePaths(paths: string[]): string[] {
  const picks = new Set<string>();
  const add = (p: string | undefined) => {
    if (p && picks.size < MAX_KEY_FILES) picks.add(p);
  };

  // Manifest / config first.
  add(paths.find((p) => p.toLowerCase() === "package.json"));
  add(paths.find((p) => /^(pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml|pom\.xml)$/i.test(p)));

  // Common entry points (shallow paths preferred).
  const entryPatterns = [
    /^(src\/)?(index|main|app|server)\.(t|j)sx?$/i,
    /^app\/(page|layout)\.(t|j)sx$/i,
    /^(src\/)?main\.py$/i,
    /^(src\/)?app\.py$/i,
    /^(src\/)?main\.go$/i,
  ];
  for (const re of entryPatterns) add(paths.find((p) => re.test(p)));

  // Fill with the shortest-path code files if still under the cap.
  if (picks.size < MAX_KEY_FILES) {
    const code = paths
      .filter((p) => /\.(t|j)sx?$|\.py$|\.go$|\.java$|\.rb$|\.rs$|\.php$/i.test(p))
      .filter((p) => !picks.has(p))
      .sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
    for (const p of code) add(p);
  }
  return [...picks];
}

export async function fetchRepoEvidence(repoUrl: string): Promise<RepoEvidence> {
  const { owner, repo } = parseRepoUrl(repoUrl);

  // Repo metadata.
  const repoRes = await gh(`/repos/${owner}/${repo}`);
  if (repoRes.status === 404) throw new GitHubError("Repository not found (is it public?)");
  if (repoRes.status === 403)
    throw new GitHubError("GitHub rate limit hit — set GITHUB_TOKEN and retry");
  if (!repoRes.ok) throw new GitHubError(`GitHub API error ${repoRes.status}`);
  const repoData = (await repoRes.json()) as {
    description: string | null;
    default_branch: string;
    language: string | null;
    license: { spdx_id?: string | null } | null;
    stargazers_count: number;
    pushed_at: string | null;
  };
  const defaultBranch = repoData.default_branch || "main";

  // README (best-effort).
  let readme: string | null = null;
  try {
    const r = await gh(`/repos/${owner}/${repo}/readme`);
    if (r.ok) {
      const j = (await r.json()) as { content?: string };
      if (j.content) readme = truncate(decodeBase64(j.content), README_MAX).text;
    }
  } catch {
    /* no README */
  }

  // File tree (recursive, best-effort).
  let allPaths: string[] = [];
  try {
    const t = await gh(`/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`);
    if (t.ok) {
      const j = (await t.json()) as { tree?: { path: string; type: string }[] };
      allPaths = (j.tree ?? []).filter((n) => n.type === "blob").map((n) => n.path);
    }
  } catch {
    /* tree unavailable */
  }

  // Key file contents.
  const keyFiles: KeyFile[] = [];
  for (const path of pickKeyFilePaths(allPaths)) {
    try {
      const c = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`);
      if (!c.ok) continue;
      const j = (await c.json()) as { content?: string; encoding?: string };
      if (j.content && j.encoding === "base64") {
        const { text, truncated } = truncate(decodeBase64(j.content), FILE_MAX);
        keyFiles.push({ path, content: text, truncated });
      }
    } catch {
      /* skip unreadable file */
    }
  }

  // Commit count (Link header) + latest commit SHA (body).
  let commitCount: number | null = null;
  let contributorCount: number | null = null;
  let headSha: string | null = null;
  try {
    const c = await gh(`/repos/${owner}/${repo}/commits?per_page=1`);
    if (c.ok) {
      commitCount = lastPageFromLink(c);
      const body = (await c.json().catch(() => null)) as { sha?: string }[] | null;
      if (Array.isArray(body) && body[0]?.sha) headSha = body[0].sha;
    }
  } catch {
    /* ignore */
  }
  try {
    const c = await gh(`/repos/${owner}/${repo}/contributors?per_page=1&anon=1`);
    if (c.ok) contributorCount = lastPageFromLink(c);
  } catch {
    /* ignore */
  }

  return {
    owner,
    repo,
    description: repoData.description,
    defaultBranch,
    language: repoData.language,
    license: repoData.license?.spdx_id ?? null,
    stars: repoData.stargazers_count,
    pushedAt: repoData.pushed_at,
    readme,
    fileTree: allPaths.slice(0, TREE_MAX),
    fileCount: allPaths.length,
    keyFiles,
    commitCount,
    contributorCount,
    headSha,
  };
}
