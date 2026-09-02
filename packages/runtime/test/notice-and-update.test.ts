/**
 * Two things that reach an owner: a line from us, and the progress of an update.
 *
 * Neither may lie about what it knows.
 *
 * The notice is pulled, never pushed. There is no list of deployments and there
 * is not going to be one, so nobody can be sent anything — the console is
 * already served from this host and asks it whether there is a line to show.
 *
 * The progress bar reaches the end only when the deployment itself reports the
 * version that was pushed. Cloudflare does not say how far through a build it
 * is, so nothing here claims to know; the middle stretch creeps and says it is
 * waiting.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (name: string): string =>
  readFileSync(new URL(`../../console/public/${name}`, import.meta.url), "utf8");
const app = read("app.js");
const api = readFileSync(new URL("../src/web/console-api.ts", import.meta.url), "utf8");

describe("the notice", () => {
  it("is asked for by the console, not pushed to the deployment", () => {
    // The deployment is never contacted. The page's own host is asked, which
    // the browser already talks to because that is where the page came from.
    expect(app).toMatch(/fetch\(`\/notice\.json\?t=/);
    expect(app).not.toMatch(/notice.*\bworker\b/i);
  });

  it("ships a file with nothing in it to say", () => {
    const notice = JSON.parse(read("notice.json")) as { id: string; text: string };
    expect(notice.id).toBe("");
    expect(notice.text).toBe("");
  });

  it("says nothing when there is nothing to say, or nothing new", () => {
    expect(app).toMatch(/if \(id\.length === 0 \|\| text\.length === 0\) return dropNotice\(\)/);
    expect(app).toMatch(/if \(readSeen\(\)\.includes\(id\)\) return dropNotice\(\)/);
  });

  it("stays quiet when it cannot ask", () => {
    // A host that is down is not news the owner needs while running their shop.
    const at = app.indexOf("async function showNotice");
    expect(app.slice(at, at + 1200)).toMatch(/\} catch \{[\s\S]{0,200}return;/);
  });

  it("can carry a button to where the update is", () => {
    expect(app).toContain('id="noticeGo"');
    expect(app).toMatch(/state\.settingsTab = "deployment";\s*\n\s*go\("settings"\)/);
  });

  it("is deployed with the console", () => {
    expect(readFileSync(new URL("../../console/deploy.sh", import.meta.url), "utf8"))
      .toContain('"$HERE/public/"*.json');
  });
});

describe("the update's progress", () => {
  it("watches for the version the push is bringing", () => {
    // Returned by the route rather than guessed at by the page.
    expect(api).toMatch(/expect: version\.latest \?\? ""/);
    expect(app).toMatch(/const expect = String\(pushed\.expect \?\? ""\)/);
  });

  it("reaches the end only when the deployment reports that version", () => {
    const at = app.indexOf("async function runUpdate");
    const body = app.slice(at, app.indexOf("function drawProgress"));
    // 100 appears once, behind the observation.
    const hundreds = [...body.matchAll(/drawProgress\(\s*100/g)];
    expect(hundreds).toHaveLength(1);
    expect(body).toMatch(/if \(ok && observable && running === expect\)/);
  });

  it("creeps rather than measures while Cloudflare builds", () => {
    // Nothing reports how far through a build is, so the middle is a wait that
    // approaches the end without arriving.
    const at = app.indexOf("async function runUpdate");
    expect(app.slice(at, app.indexOf("function drawProgress"))).toMatch(/1 - Math\.exp\(-waited/);
  });

  it("says plainly when it cannot tell that the update landed", () => {
    // A release that did not change the version number is one this page can
    // never observe. Spinning forever would be the dishonest answer.
    const at = app.indexOf("async function runUpdate");
    const body = app.slice(at, app.indexOf("function drawProgress"));
    expect(body).toContain("did not change the version number");
    expect(body).toMatch(/waited > UPDATE_PATIENCE_MS/);
  });

  it("offers the reload rather than asking the owner to remember to", () => {
    expect(app).toContain('id="updateReload"');
    expect(app).toMatch(/\$\("updateReload"\)\.onclick = \(\) => location\.reload\(\)/);
  });
});

describe("the version this release brings", () => {
  it("is bumped, or nothing downstream can see the update land", () => {
    const version = readFileSync(new URL("../../../VERSION", import.meta.url), "utf8").trim();
    const source = readFileSync(new URL("../src/version.ts", import.meta.url), "utf8");
    expect(source).toContain(`MUXEL_VERSION = "${version}"`);
  });
});
