import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  enableUpdatesUrl,
  isRepoSlug,
  updateWorkflowUrl,
  workflowPermissionsUrl,
} from "../src/repo.js";
import { UPDATE_STUB } from "../src/updateStub.js";

/**
 * The setup page commits this file into the operator's repository through a
 * pre-filled GitHub link, and the same file ships in .github/workflows for
 * anyone reading the repository. If the two drift, half the operators run one
 * updater and half run another, and a bug report stops naming a single thing.
 */

describe("the update stub", () => {
  it("matches the workflow file in the repository byte for byte", async () => {
    const onDisk = await readFile(
      fileURLToPath(new URL("../../../.github/workflows/update.yml", import.meta.url)),
      "utf8",
    );
    expect(UPDATE_STUB).toBe(onDisk);
  });

  it("stays a stub: the sync logic must not live in the pasted file", () => {
    // Anything in the stub is frozen in every operator's repo forever, because
    // the sync deliberately leaves .github/ alone and the workflow token could
    // not push a change there anyway. Logic belongs in scripts/update.sh.
    expect(UPDATE_STUB).toContain("scripts/update.sh");
    expect(UPDATE_STUB).not.toContain("git checkout FETCH_HEAD");
    expect(UPDATE_STUB).not.toContain("git push");
  });

  it("runs the script from outside the tree it replaces", () => {
    expect(UPDATE_STUB).toContain("cp scripts/update.sh /tmp/");
  });

  it("never runs on upstream itself", () => {
    expect(UPDATE_STUB).toContain("github.repository != 'thankywal/muxel'");
  });

  it("holds a single run at a time", () => {
    // The Telegram button invites manual runs; without this they race the
    // schedule and the loser pushes into a moved branch.
    expect(UPDATE_STUB).toContain("concurrency:");
  });

  it("fits in a pre-filled GitHub URL with room to spare", () => {
    // github.com refuses URLs over 8192 bytes with HTTP 414.
    expect(enableUpdatesUrl("owner/repo", UPDATE_STUB).length).toBeLessThan(6000);
  });
});

describe("the links the buttons open", () => {
  it("builds the three GitHub pages from a slug", () => {
    expect(updateWorkflowUrl("a/b")).toBe("https://github.com/a/b/actions/workflows/update.yml");
    expect(workflowPermissionsUrl("a/b")).toBe("https://github.com/a/b/settings/actions");
  });

  it("keeps the nested path in the filename parameter, not the URL path", () => {
    // GitHub drops the last directory of the URL path when filename is given,
    // so directories in the path would land the file one level up.
    const url = enableUpdatesUrl("a/b", "content");
    expect(url).toContain("/new/main?filename=.github%2Fworkflows%2Fupdate.yml");
    expect(url).not.toContain("/new/main/.github");
  });

  it("accepts only things shaped like a repository", () => {
    expect(isRepoSlug("thankywal/muxel")).toBe(true);
    expect(isRepoSlug("owner/repo.name-x_1")).toBe(true);
    expect(isRepoSlug("")).toBe(false);
    expect(isRepoSlug("no-slash")).toBe(false);
    expect(isRepoSlug("a/b/c")).toBe(false);
    expect(isRepoSlug("a b/c")).toBe(false);
    expect(isRepoSlug("owner/repo?x=1")).toBe(false);
  });
});
