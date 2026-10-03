import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@/lib/requireOrganizer";
import { JudgeServiceError } from "@/lib/judges";

/** Map auth/validation/service errors to the project's `{ error }` JSON responses. */
export function judgeErrorResponse(e: unknown) {
  if (e instanceof HttpError || e instanceof JudgeServiceError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json({ error: e.issues[0]?.message ?? "Validation failed", details: e.flatten() }, { status: 400 });
  }
  if (e instanceof SyntaxError) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  throw e;
}
