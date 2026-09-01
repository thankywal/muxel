/**
 * The update asked GitHub for a repository whose name was a URL.
 *
 * One constant held `https://github.com/thankywal/muxel`, which is right for
 * the two places that show it to a person to click, and was also interpolated
 * into API paths. That produced
 * `/repos/https://github.com/thankywal/muxel/branches/main`, a 404 on the very
 * first call the update makes, and an error that said only "GitHub said 404".
 *
 * So the self update had never worked, for anyone, and nothing said why. One
 * name with two meanings, and the call site could not tell which it had.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { UPSTREAM_REPO_URL, UPSTREAM_SLUG } from "../src/version.js";
import { isRepoSlug } from "../src/repo.js";

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("the two shapes of an upstream address", () => {
  it("keeps a slug that is a slug", () => {
    expect(isRepoSlug(UPSTREAM_SLUG)).toBe(true);
    expect(UPSTREAM_SLUG).not.toContain("://");
  });

  it("derives the URL from it, so they cannot drift", () => {
    expect(UPSTREAM_REPO_URL).toBe(`https://github.com/${UPSTREAM_SLUG}`);
  });
});

describe("what goes into a GitHub API path", () => {
  const update = src("web/self-update.ts");

  it("never interpolates a URL into /repos/", () => {
    // Every `/repos/${x}` in this file must take a slug.
    const interpolations = [...update.matchAll(/\/repos\/\$\{([A-Za-z0-9_.]+)\}/g)].map((m) => m[1]);
    expect(interpolations.length).toBeGreaterThan(0);
    for (const name of interpolations) {
      expect(name, `${name} is interpolated into a /repos/ path`).not.toMatch(/URL$/);
    }
  });

  it("does not hold the URL at all, so it cannot be aliased back in", () => {
    // Checking the identifier's spelling is not enough: an import can be
    // renamed, and the first attempt at this test was fooled by exactly that.
    // A file that builds API paths has no use for the browser address.
    expect(update).not.toContain("UPSTREAM_REPO_URL");
  });

  it("says which path was not found", () => {
    // "GitHub said 404" is true and useless: the update touches two
    // repositories over eight endpoints.
    expect(update).toContain("for ${path}");
  });

  it("checks the target is shaped like a repository, not that it is null", () => {
    // SOURCE_REPO is the empty string when the build could not tell, never
    // null, so the old guard passed and GitHub was asked for `/repos//…`.
    expect(update).not.toContain("target === null");
    expect(update).toContain("isRepoSlug(target)");
  });
});


describe("the blobs a tree points at", () => {
  const update = readFileSync(new URL("../src/web/self-update.ts", import.meta.url), "utf8");

  it("copies content the target repository does not already hold", () => {
    // A blob sha is content addressed, so unchanged files are already objects
    // this repository has from its own history. New content is not: the deploy
    // button imports rather than forks, so there is no shared object store, and
    // a tree naming blobs it has never seen is answered with 422.
    expect(update).toContain("/git/blobs/${entry.sha}");
    expect(update).toContain("`/repos/${target}/git/blobs`");
  });

  it("works out what is missing rather than copying everything", () => {
    // Copying all of them would be two requests per file for a repository of
    // hundreds, which no invocation has the budget for.
    expect(update).toContain("const held = new Set(");
    expect(update).toContain("files.filter((entry) => !held.has(entry.sha))");
  });

  it("stops short of the subrequest limit instead of dying at it", () => {
    // Two requests per copy, fifty per invocation on the free plan.
    expect(update).toContain("MAX_BLOBS_PER_RUN");
    expect(update).toContain("Press Update again to continue");
  });

  it("remembers what it copied, since nothing points at it yet", () => {
    // A blob with no tree referring to it is not in the tree to be found, so a
    // second press would copy the same file again and again.
    expect(update).toContain("rememberCopied");
    expect(update).toContain("copiedAlready");
    // And forgets once the commit lands, because from then on the tree has it.
    expect((update.match(/forgetCopied\(env\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("no longer claims the objects are already there", () => {
    expect(update).not.toContain("the objects are already there");
  });
});
