/**
 * A header the console sends is a header the preflight allows.
 *
 * The console is served from somewhere else and calls the owner's Worker
 * directly, so every request with a header of its own is preceded by a
 * preflight. A header missing from `access-control-allow-headers` is refused by
 * the browser before the Worker is ever reached, and refused silently: the
 * console sees a failed fetch with no status and no body, which reads as a
 * deployment that is down.
 *
 * `x-chat-id` was exactly that, added with the file door and not to the list.
 * So this walks the console's own source rather than a list somebody kept up
 * to date by hand.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");
const console_ = readFileSync(new URL("../src/web/console.ts", import.meta.url), "utf8");

/** The allow list, joined back up however it is wrapped in the source. */
const allowed = (() => {
  const at = console_.indexOf('"access-control-allow-headers"');
  const value = console_.slice(at + '"access-control-allow-headers"'.length, console_.indexOf('"access-control-allow-methods"', at));
  return [...value.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
})();

/** Every header name the console puts on a request of its own. */
const sent = [...app.matchAll(/"(x-[a-z-]+)":/g)].map((m) => m[1]);

describe("the console's own headers", () => {
  it("are each allowed through the preflight", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const header of new Set(sent)) {
      expect(allowed, `${header} is sent by the console and not allowed`).toContain(header);
    }
  });

  it("includes the ones the file door needs", () => {
    expect(sent).toContain("x-filename");
    expect(sent).toContain("x-chat-id");
  });
});
