import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MUXEL_VERSION, UPSTREAM_REPO, UPSTREAM_VERSION_URL } from "../src/version.js";

/**
 * A deployment finds out it is behind by comparing its own constant against the
 * VERSION file upstream. If the two ever disagree, every deployment either
 * misses a release or nags about one that does not exist, so they are checked
 * against each other here rather than by memory.
 */
describe("version", () => {
  it("matches the VERSION file the update check reads", async () => {
    const path = fileURLToPath(new URL("../../../VERSION", import.meta.url));
    const published = (await readFile(path, "utf8")).trim();
    expect(published).toBe(MUXEL_VERSION);
  });

  it("is a plain dotted version, since it is compared as a string", () => {
    expect(MUXEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("reads the version from the upstream default branch", () => {
    expect(UPSTREAM_VERSION_URL).toBe(
      "https://raw.githubusercontent.com/thankywal/muxel/main/VERSION",
    );
  });

  it("points at a repository a person can open", () => {
    expect(UPSTREAM_REPO).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  });
});
