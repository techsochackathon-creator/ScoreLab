import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { evaluateSubmission } from "@/inngest/functions/evaluateSubmission";

// Allow long-running steps (server healthcheck, Playwright, Lighthouse).
// Requires a Vercel plan that permits this; lower if needed.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [evaluateSubmission],
});
