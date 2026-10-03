/**
 * Turn an API error into a clear, user-facing message (presentation only — the
 * server's status codes and rules are unchanged). Specific, useful server
 * messages are kept; only generic/technical cases are rewritten.
 */
export function friendlyApiError(status: number, serverMessage: string | undefined, fallback = "Something went wrong. Please try again."): string {
  const msg = (serverMessage ?? "").trim();

  if (status === 409) {
    if (/reopen judging/i.test(msg)) return msg;
    if (/already started an evaluation/i.test(msg)) return "This assignment cannot be removed because the judge has already started an evaluation.";
    if (/has been submitted/i.test(msg)) return "This evaluation has already been submitted and cannot be changed.";
    if (/teams can no longer be modified/i.test(msg)) return "Results have been finalized. Teams can no longer be added, edited or deleted.";
    if (/finalized/i.test(msg) && !/before judging has been finalized|not finalized/i.test(msg)) return "Results have been finalized. This action is no longer available.";
  }
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return msg && !/access required/i.test(msg) ? msg : "You don't have permission to do that.";
  if (status >= 500) return "The server hit a problem. Please try again in a moment.";
  return msg || fallback;
}

/** Read `{ error }` from a failed fetch Response and make it user-facing. */
export async function readApiError(res: Response, fallback?: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  return friendlyApiError(res.status, typeof data.error === "string" ? data.error : undefined, fallback);
}
