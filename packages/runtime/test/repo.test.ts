import { afterEach, describe, expect, it, vi } from "vitest";

import { repositorySettingsUrl, repositoryVisibility, SOURCE_REPO } from "../src/repo.js";

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

describe("SOURCE_REPO", () => {
  it("ships empty so a copy points at itself rather than upstream", () => {
    // Stamped by the build from the checkout it ran in. Committing a value
    // here would make every deployment link at whoever built it last.
    expect(SOURCE_REPO).toBe("");
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
