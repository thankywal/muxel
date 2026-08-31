/**
 * The console door's shape, pinned.
 *
 * Written after a preflight returned 500 in production. The cause was a 204
 * built with a body, which Workers rejects, and nothing in the suite would have
 * noticed because every other test asks for JSON back.
 */
import { describe, expect, it } from "vitest";
import { handleConsoleRequest } from "../src/web/console.js";

/** Enough of an Env for the paths that never touch storage. */
const env = {} as never;

const post = (path: string, body: unknown = {}): Request =>
  new Request(`https://example.workers.dev/admin${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("the console door", () => {
  it("answers a preflight with no body, which is what 204 means", async () => {
    const response = await handleConsoleRequest(
      env,
      new Request("https://example.workers.dev/admin/screen", { method: "OPTIONS" }),
      "/screen",
    );
    expect(response).not.toBeNull();
    expect(response?.status).toBe(204);
    expect(response?.body).toBeNull();
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("refuses an unauthenticated screen rather than serving one", async () => {
    const response = await handleConsoleRequest(env, post("/screen", { action: "home" }), "/screen");
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: "unauthorised" });
  });

  it("carries the cross origin headers on a real answer, not only on the preflight", async () => {
    const response = await handleConsoleRequest(env, post("/screen"), "/screen");
    expect(response?.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("leaves paths that are not its own to the caller", async () => {
    const response = await handleConsoleRequest(env, post("/nope"), "/nope");
    expect(response).toBeNull();
  });
});
