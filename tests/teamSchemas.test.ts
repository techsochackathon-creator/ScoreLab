/**
 * Team create/update input: the simplified team form (code, name, repo URL,
 * project name, members) must be accepted, and the repo URL must be kept.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firstFieldError, teamCreateInput, teamUpdateInput } from "../src/lib/teamSchemas";

// Exactly what TeamsManager sends (see src/components/TeamsManager.tsx).
const FORM = {
  teamCode: "TH-2026-2233",
  name: "Coders",
  memberNames: ["Ali ahmad"],
  projectTitle: "Study spark",
  repoUrl: "https://github.com/reejasohail88/studyspark.git",
};

describe("create (POST /api/teams)", () => {
  it("accepts the form payload — no university/track needed — and keeps the repo URL", () => {
    const t = teamCreateInput.parse(FORM);
    assert.equal(t.repoUrl, "https://github.com/reejasohail88/studyspark.git");
    assert.equal(t.university, "");
    assert.equal(t.track, "General");
    assert.deepEqual(t.memberNames, ["Ali ahmad"]);
    assert.deepEqual(t.technologies, []);
    assert.equal(t.projectTitle, "Study spark");
  });

  it("still accepts the old payload that sent university/track", () => {
    const t = teamCreateInput.parse({ ...FORM, university: "FAST NUCES", track: "AI/ML" });
    assert.equal(t.university, "FAST NUCES");
    assert.equal(t.track, "AI/ML");
    assert.equal(teamCreateInput.parse({ ...FORM, university: "", track: "" }).track, "General");
  });

  it("repo URL: empty or null clears it, omitted is fine, a bad URL is rejected with a clear message", () => {
    assert.equal(teamCreateInput.parse({ ...FORM, repoUrl: "" }).repoUrl, null);
    assert.equal(teamCreateInput.parse({ ...FORM, repoUrl: null }).repoUrl, null);
    const { repoUrl: _omit, ...without } = FORM;
    void _omit;
    assert.equal(teamCreateInput.parse(without).repoUrl, undefined);
    const bad = teamCreateInput.safeParse({ ...FORM, repoUrl: "not a url" });
    assert.equal(bad.success, false);
    assert.equal(firstFieldError(bad.error?.flatten().fieldErrors), "repoUrl: enter a valid repository URL");
  });

  it("still requires a team code and a name", () => {
    assert.equal(teamCreateInput.safeParse({ ...FORM, teamCode: "  " }).success, false);
    assert.equal(teamCreateInput.safeParse({ ...FORM, name: "" }).success, false);
    const bad = teamCreateInput.safeParse({ ...FORM, name: "" });
    assert.equal(firstFieldError(bad.error?.flatten().fieldErrors), "name: name is required");
  });

  it("trims whitespace", () => {
    const t = teamCreateInput.parse({ ...FORM, teamCode: "  T1  ", name: "  Rockets " });
    assert.deepEqual([t.teamCode, t.name], ["T1", "Rockets"]);
  });
});

describe("update (PUT /api/teams/[id])", () => {
  it("accepts the form payload and leaves unsent fields undefined, so they stay unchanged", () => {
    const t = teamUpdateInput.parse(FORM);
    assert.equal(t.repoUrl, "https://github.com/reejasohail88/studyspark.git");
    assert.equal(t.university, undefined);
    assert.equal(t.track, undefined);
    assert.equal(t.technologies, undefined);
    assert.equal(t.projectDescription, undefined);
  });

  it("an explicit empty repo URL clears it; explicit university/track are honoured", () => {
    assert.equal(teamUpdateInput.parse({ ...FORM, repoUrl: "" }).repoUrl, null);
    const t = teamUpdateInput.parse({ ...FORM, university: "FAST NUCES", track: "AI/ML" });
    assert.deepEqual([t.university, t.track], ["FAST NUCES", "AI/ML"]);
  });

  it("rejects a bad repo URL and an empty name", () => {
    assert.equal(teamUpdateInput.safeParse({ ...FORM, repoUrl: "nope" }).success, false);
    assert.equal(teamUpdateInput.safeParse({ ...FORM, name: "" }).success, false);
  });
});

describe("firstFieldError", () => {
  it("returns the first field message, or null when there is none", () => {
    assert.equal(firstFieldError({ name: ["name is required"], repoUrl: ["bad"] }), "name: name is required");
    assert.equal(firstFieldError({ name: [] }), null);
    assert.equal(firstFieldError(undefined), null);
  });
});
