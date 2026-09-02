/**
 * Whether the owner's own copy is public, and who gets to change it.
 *
 * Making a repository private is one click on GitHub. It is deliberately not a
 * button in the console: flipping a repository's visibility needs
 * Administration rights, and a deployment holding a token with those could also
 * delete the repository. Storing that in order to change one bit is a bad trade
 * for a product whose whole claim is that nothing of ours touches the account.
 *
 * So the console reads the state with the token it already has — repository
 * metadata is readable by any fine grained token that can see the repository,
 * which is exactly the permission the update already needs — and links to the
 * page where the owner does it themselves.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../src/web/console-api.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");
const route = api.slice(api.indexOf('if (method === "GET" && segments[0] === "source-repo")'), api.indexOf('if (method === "PUT" && segments[0] === "source-repo")'));
const panel = app.slice(app.indexOf("async function drawRepoPrivacy"), app.indexOf("What version this deployment is on"));

describe("reading it", () => {
  it("only reads — nothing here can change a repository", () => {
    expect(route).not.toMatch(/method: "PATCH"/);
    expect(route).not.toContain('"private": true');
    expect(app).not.toMatch(/private:\s*true/);
  });

  it("uses the token the update already needs, and asks for no more", () => {
    expect(route).toContain('getSecret(env, "github_token")');
    // The permission the console asks an owner for stays what it was. A button
    // that flipped visibility would have to ask for Administration, which also
    // grants deleting the repository.
    const asked = app.slice(app.indexOf("Make a fine grained token"), app.indexOf("Make a fine grained token") + 240);
    expect(asked).toContain("Contents: read and write");
    expect(asked).not.toContain("Administration");
  });

  it("does not call a repository safe when it could not ask", () => {
    // Null is "we do not know". Defaulting to private would be a reassurance
    // nobody checked.
    expect(route).toMatch(/let isPrivate: boolean \| null = null;/);
    expect(panel).toMatch(/data\.private === null/);
    expect(panel).toMatch(/GitHub did not say/);
  });

  it("is its own route, not a field on the one every page load asks for", () => {
    const system = api.slice(api.indexOf('if (method === "GET" && segments[0] === "system")'), api.indexOf("// The GitHub token this deployment"));
    expect(system).not.toContain("api.github.com/repos");
  });
});

describe("what the owner is told", () => {
  it("says which it is, in its own words", () => {
    expect(panel).toMatch(/is private\./);
    expect(panel).toMatch(/is public\./);
  });

  it("says what is in the repository, and what is not", () => {
    // So the owner can judge for themselves rather than take "for safety" on
    // trust. Secrets and customers are not in it; ids and the code are.
    for (const said of ["Cloudflare secrets", "your own D1", "ids of your D1 and KV"]) {
      expect(panel, said).toContain(said);
    }
  });

  it("says updates keep working when it is private", () => {
    // The reason is checkable: every GitHub call the update makes carries the
    // owner's token, so none of them depends on the repository being public.
    const update = readFileSync(new URL("../src/web/self-update.ts", import.meta.url), "utf8");
    const calls = update.match(/gh(?:<[^>]*>)?\(\s*token,/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    expect(update).not.toMatch(/fetch\(`https:\/\/api\.github\.com[^`]*`\s*\)/);
    expect(panel).toMatch(/Updates work exactly the same when it is\s+private/);
  });

  it("sends them to the page where the switch is", () => {
    expect(route).toMatch(/https:\/\/github\.com\/\$\{repo\}\/settings/);
    expect(panel).toContain("Make it private on GitHub");
  });

  it("lets them say they have done it, and checks again", () => {
    expect(panel).toContain('id="repoRecheck"');
    expect(panel).toMatch(/drawRepoPrivacy\(\);/);
  });
});
