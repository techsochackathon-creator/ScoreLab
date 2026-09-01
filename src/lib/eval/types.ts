/** Metrics gathered across the evaluation pipeline, fed into scoring. */

export interface ViewportResult {
  width: number;
  status: number | null;
  overflow: boolean;
  /** true when the page loaded (2xx/3xx), no overflow, and screenshot taken. */
  ok: boolean;
  blobUrl: string | null;
}

export interface AuthorshipMetric {
  totalCommits: number;
  authors: number;
  perAuthor: Record<string, number>;
  minCommits: number;
}

export interface EvalMetrics {
  build: {
    installExit: number | null;
    startReachable: boolean;
    startHttpCode: number | null;
    logsTail: string;
  };
  responsiveness: {
    viewports: ViewportResult[];
  };
  uptime: {
    checked: boolean;
    httpStatus: number | null;
    responseMs: number | null;
  };
  lighthouse: {
    performance: number | null; // 0-100
    accessibility: number | null; // 0-100
  };
  codeQuality: {
    readme: boolean;
    tests: boolean;
    authorship: AuthorshipMetric;
  };
}

export interface ResolvedManifest {
  installCommand: string;
  runCommand: string;
  port: number;
  env: Record<string, string>;
  source: "repo-yaml" | "repo-json" | "submission";
}
