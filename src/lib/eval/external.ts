/**
 * Checks that run OUTSIDE the sandbox, from the Inngest function itself:
 *  - uptime: a plain fetch against the team's liveUrl
 *  - Lighthouse: Google PageSpeed Insights API (runs Lighthouse remotely, so no
 *    headless Chrome is needed on the serverless runtime).
 *
 * PAGESPEED_API_KEY is optional but strongly recommended to avoid rate limits.
 */

export async function checkUptime(liveUrl: string): Promise<{
  checked: boolean;
  httpStatus: number | null;
  responseMs: number | null;
}> {
  const start = Date.now();
  try {
    const res = await fetch(liveUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    return {
      checked: true,
      httpStatus: res.status,
      responseMs: Date.now() - start,
    };
  } catch {
    return { checked: true, httpStatus: null, responseMs: Date.now() - start };
  }
}

export async function runLighthousePSI(liveUrl: string): Promise<{
  performance: number | null;
  accessibility: number | null;
}> {
  const endpoint = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
  );
  endpoint.searchParams.set("url", liveUrl);
  endpoint.searchParams.append("category", "PERFORMANCE");
  endpoint.searchParams.append("category", "ACCESSIBILITY");
  endpoint.searchParams.set("strategy", "MOBILE");
  if (process.env.PAGESPEED_API_KEY) {
    endpoint.searchParams.set("key", process.env.PAGESPEED_API_KEY);
  }

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { performance: null, accessibility: null };
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: {
          performance?: { score?: number | null };
          accessibility?: { score?: number | null };
        };
      };
    };
    const cats = data.lighthouseResult?.categories;
    const toPct = (s?: number | null) =>
      s == null ? null : Math.round(s * 100);
    return {
      performance: toPct(cats?.performance?.score),
      accessibility: toPct(cats?.accessibility?.score),
    };
  } catch {
    return { performance: null, accessibility: null };
  }
}
