/**
 * Phase 8: user-facing API error messages (presentation only).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { friendlyApiError, readApiError } from "../src/lib/uiErrors";

describe("friendlyApiError", () => {
  it("409 after finalization → one clear message", () => {
    assert.equal(
      friendlyApiError(409, "Judging has been finalized. Official results can no longer be changed."),
      "Results have been finalized. This action is no longer available.",
    );
  });

  it("409 team lock keeps the team-specific meaning", () => {
    assert.equal(
      friendlyApiError(409, "Results have been finalized and teams can no longer be modified."),
      "Results have been finalized. Teams can no longer be added, edited or deleted.",
    );
  });

  it("409 submitted evaluation", () => {
    assert.equal(
      friendlyApiError(409, "This evaluation has been submitted and can no longer be changed"),
      "This evaluation has already been submitted and cannot be changed.",
    );
  });

  it("409 assignment removal after an evaluation started", () => {
    assert.equal(
      friendlyApiError(409, "This assignment cannot be removed because the judge has already started an evaluation."),
      "This assignment cannot be removed because the judge has already started an evaluation.",
    );
  });

  it("keeps useful specific messages (not rewritten as 'finalized')", () => {
    const publish = "Cannot publish results before judging has been finalized.";
    assert.equal(friendlyApiError(409, publish), publish);
    const tie = "Cannot finalize: A01 and B02 are tied at 91.50.";
    assert.equal(friendlyApiError(400, tie), tie);
    assert.equal(friendlyApiError(409, "Already assigned to this judge: T-1"), "Already assigned to this judge: T-1");
    assert.equal(friendlyApiError(409, "The rubric is locked because judging has already started."), "The rubric is locked because judging has already started.");
  });

  it("auth and server errors become plain language; empty messages fall back", () => {
    assert.equal(friendlyApiError(401, "Not authenticated"), "Your session has expired. Please sign in again.");
    assert.equal(friendlyApiError(403, "Organizer access required"), "You don't have permission to do that.");
    assert.equal(friendlyApiError(500, "PrismaClientKnownRequestError: ..."), "The server hit a problem. Please try again in a moment.");
    assert.equal(friendlyApiError(400, undefined, "Save failed"), "Save failed");
  });

  it("readApiError reads { error } from a Response", async () => {
    const res = new Response(JSON.stringify({ error: "Judging has been finalized. Official results can no longer be changed." }), { status: 409 });
    assert.equal(await readApiError(res), "Results have been finalized. This action is no longer available.");
    assert.equal(await readApiError(new Response("not json", { status: 502 })), "The server hit a problem. Please try again in a moment.");
  });
});
