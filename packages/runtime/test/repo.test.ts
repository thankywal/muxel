import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { repositorySettingsUrl, repositoryVisibility } from "../src/repo.js";

/**
 * The setup page nags an operator to make their copy private and stops once
 * they have. Reading a rate limit or an outage as "already private" would
 * silence the one notice that matters, so anything that is not a clean answer
 * stays unknown.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function status(code: number): Response {
  return new Response(code === 200 ? "{}" : "", { status: code });
}

describe("the committed stamp", () => {
  it("is empty, so a copy never links at whoever built it last", () => {
    // Read from git rather than from the import, because the build stamps the
    // working copy before the tests run and would make an import assertion
    // pass or fail depending on where it was invoked. What has to stay empty
    // is the value that ships, and that is the one in the commit.
    let committed: string;
    try {
      committed = execFileSync("git", ["show", "HEAD:packages/runtime/src/repo.ts"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // A checkout without git history cannot answer this, and failing there
      // would report a problem with the environment as a problem with the code.
      return;
    }
    expect(committed).toContain('export const SOURCE_REPO = "";');
  });
});

describe("repositoryVisibility", () => {
  it("treats a 200 as public, because anyone could read it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(status(200)));
    expect(await repositoryVisibility("owner/name")).toBe("public");
  });

  it("treats a 404 as private, which is what GitHub answers when hidden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(status(404)));
    expect(await repositoryVisibility("owner/name")).toBe("private");
  });

  it("does not read a rate limit as private", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(status(403)));
    expect(await repositoryVisibility("owner/name")).toBe("unknown");
  });

  it("does not read an outage as private", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await repositoryVisibility("owner/name")).toBe("unknown");
  });

  it("asks nothing when the build could not name a repository", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await repositoryVisibility("")).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends no credentials, so no token has to exist for this to work", async () => {
    const fetchMock = vi.fn().mockResolvedValue(status(200));
    vi.stubGlobal("fetch", fetchMock);

    await repositoryVisibility("owner/name");

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("authorization");
  });
});

describe("repositorySettingsUrl", () => {
  it("points at the page holding the visibility control", () => {
    expect(repositorySettingsUrl("acme/shop")).toBe("https://github.com/acme/shop/settings");
  });
});
