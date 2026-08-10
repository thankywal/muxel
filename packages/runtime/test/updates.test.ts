import { afterEach, describe, expect, it, vi } from "vitest";

import { latestVersion, versionStatus } from "../src/updates.js";
import { MUXEL_VERSION } from "../src/version.js";

/**
 * The update notice failed once by staying silent, which is the worst way for
 * a check to fail: indistinguishable from having nothing to report. These tests
 * pin the reachability cases and, above all, that the request is not pinned to
 * a stale cached response.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("latestVersion", () => {
  it("reads a published version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond("9.9.9\n")));
    expect(await latestVersion()).toBe("9.9.9");
  });

  it("does not override the cache with a long lived pin", async () => {
    // A one hour pin here kept a deployment reading a superseded version
    // through several releases, so the absence of the override is the fix.
    const fetchMock = vi.fn().mockResolvedValue(respond("9.9.9"));
    vi.stubGlobal("fetch", fetchMock);

    await latestVersion();

    const init = fetchMock.mock.calls[0][1] as { cf?: { cacheTtl?: number } };
    expect(init.cf?.cacheTtl).toBeUndefined();
  });

  it("rejects a body that is not a version, such as an error page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond("<!doctype html>404")));
    expect(await latestVersion()).toBeNull();
  });

  it("reports nothing rather than guessing when upstream errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond("", 500)));
    expect(await latestVersion()).toBeNull();
  });

  it("reports nothing when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await latestVersion()).toBeNull();
  });
});

describe("versionStatus", () => {
  it("is behind when upstream has moved on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond("99.0.0")));
    expect(await versionStatus()).toEqual({
      running: MUXEL_VERSION,
      latest: "99.0.0",
      behind: true,
    });
  });

  it("is current when the versions match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(MUXEL_VERSION)));
    expect(await versionStatus()).toEqual({
      running: MUXEL_VERSION,
      latest: MUXEL_VERSION,
      behind: false,
    });
  });

  it("is not behind when the answer is unknown, so it cannot nag on a blip", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const status = await versionStatus();
    expect(status.latest).toBeNull();
    expect(status.behind).toBe(false);
  });
});
