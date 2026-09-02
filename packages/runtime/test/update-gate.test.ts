/**
 * A check that has not finished is not a check that failed.
 *
 * scripts/update.sh only applies an upstream commit whose own checks passed.
 * The state comes out of one jq expression, and that expression used to fold a
 * null conclusion — a run still going — in with the failures. The outcome was
 * the same either way (nothing applied), but the log said the upstream build
 * had failed, which sends whoever reads it looking for a break that is not
 * there. Unknown is its own answer, and it has to be said as one.
 *
 * The expression is run here rather than pattern-matched, because what matters
 * is what jq returns for each shape GitHub actually sends.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("../../../scripts/update.sh", import.meta.url), "utf8");

/** The expression the script uses, lifted out of it rather than retyped. */
const EXPRESSION = (() => {
  const start = script.indexOf("'[.check_runs[].conclusion]");
  const end = script.indexOf("')", start);
  return script.slice(start + 1, end);
})();

const stateFor = (conclusions: (string | null)[]): string =>
  execFileSync("jq", ["-r", EXPRESSION], {
    input: JSON.stringify({ check_runs: conclusions.map((conclusion) => ({ conclusion })) }),
    encoding: "utf8",
  }).trim();

describe("what the script makes of upstream's checks", () => {
  it("calls a finished, passing run a pass", () => {
    expect(stateFor(["success", "success"])).toBe("success");
    // Skipped and neutral are how a job that had nothing to do reports itself.
    expect(stateFor(["success", "skipped", "neutral"])).toBe("success");
  });

  it("calls a run still going pending, not failed", () => {
    // The bug. A null conclusion is a job that has not finished, and every
    // release lands with one for a minute or two.
    expect(stateFor([null])).toBe("pending");
    expect(stateFor(["success", null])).toBe("pending");
  });

  it("does not let a pass elsewhere cover an unfinished job", () => {
    expect(stateFor(["success", "skipped", null])).toBe("pending");
  });

  it("calls a failure a failure", () => {
    expect(stateFor(["failure"])).toBe("failed");
    expect(stateFor(["success", "failure"])).toBe("failed");
    expect(stateFor(["timed_out"])).toBe("failed");
  });

  it("calls no checks at all pending, rather than a pass", () => {
    // A commit nobody has checked is not a commit that passed.
    expect(stateFor([])).toBe("pending");
  });
});

describe("what it says about it", () => {
  it("only applies on a pass", () => {
    expect(script).toContain('if [ "$state" != "success" ]');
  });

  it("says something different for still-running than for broken", () => {
    expect(script).toMatch(/still being checked/);
    expect(script).toMatch(/checks failed/);
  });

  it("does not promise a run that may never come", () => {
    // The stub workflow carries the schedule, and a copy made by the deploy
    // button has no stub at all — the Cloudflare GitHub App cannot create
    // workflow files. Telling that owner to wait for the next schedule is
    // telling them to wait forever.
    expect(script).not.toContain("This runs again on the next schedule.");
  });
});
