/**
 * Three things the console showed wrong, reported from a live deployment.
 *
 * **Recent activity said "Nothing recorded yet." on a deployment with 27
 * messages, five conversations and two businesses.** It was telling the truth.
 * The event log had exactly one writer — the Telegram reply path, on its two
 * error branches — so a deployment answering on the website recorded nothing,
 * ever, and a panel on the dashboard was permanently empty. It is written now
 * where the things worth knowing happen: a customer waiting for a person, a
 * change the owner made or refused, a document indexed, a reply that failed on
 * either channel. Each one is written at the one place that knows, so a third
 * channel cannot arrive without them.
 *
 * **The "?" beside the cost did nothing.** It was a span carrying a `title`,
 * so the only way to the sentence was to hover and wait, a click did nothing,
 * and a keyboard never reached it — on the one control whose whole job is to
 * explain a number that is missing.
 *
 * **The agent icon** is the owner's own: a pixel octopus, filled, in whatever
 * ink the surface around it uses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const src = (path: string) => read(`../src/${path}`);
const app = read("../../console/public/app.js");
const css = read("../../console/public/app.css");

describe("what the deployment writes down", () => {
  it("records a customer waiting, wherever they wrote from", () => {
    // Inside openHandover, not at its callers: a channel added later would
    // otherwise arrive with a handover nobody is told about.
    const fn = src("db/queries.ts");
    const open = fn.slice(fn.indexOf("export async function openHandover"), fn.indexOf("export async function takeOverConversation"));
    expect(open).toContain('kind: "waiting_for_a_person"');
    // Only when this call is what opened it — a customer with three
    // unanswerable questions is one thing to do, so it is one line. What that
    // means in each case is run against a database further down.
    expect(open).toMatch(/if \(opened\) \{[\s\S]*recordEvent/);
  });

  it("asks the database which branch the upsert took, in the same statement", () => {
    // A SELECT before every handover would be a read for the common case.
    const fn = src("db/queries.ts");
    const open = fn.slice(fn.indexOf("export async function openHandover"), fn.indexOf("export async function takeOverConversation"));
    expect(open).toContain("RETURNING opened_at");
    expect(open).toMatch(/Promise<boolean>/);
  });

  it("records what the owner said yes and no to", () => {
    const decide = src("assistant/decide.ts");
    expect(decide).toContain('note(env, approval, "change_declined")');
    expect(decide).toContain('note(env, approval, "change_made")');
    expect(decide).toContain('note(env, approval, "change_failed", detail)');
    // The card's own sentence, which is the one the owner read before tapping.
    expect(decide).toMatch(/detail: `\$\{approval\.summary \|\| approval\.tool\}/);
  });

  it("never lets the log break the thing it is logging", () => {
    const decide = src("assistant/decide.ts");
    expect((decide.match(/note\(env, approval[^)]*\)\.catch\(\(\) => undefined\)/g) ?? []).length).toBe(3);
    expect(src("rag/ingest.ts")).toMatch(/kind: "document_added"[\s\S]{0,160}catch\(\(\) => undefined\)/);
    expect(src("web/routes.ts")).toMatch(/kind: "reply_failed"[\s\S]{0,200}catch\(\(\) => undefined\)/);
  });

  it("records a reply that failed on the website too, not only on Telegram", () => {
    // The reason the panel was empty: one channel had the only writer.
    expect(src("web/routes.ts")).toContain('kind: "reply_failed"');
    expect(src("telegram/reply.ts")).toContain('kind: "reply_failed"');
  });

  it("records a document once, at the one door every upload goes through", () => {
    const ingest = src("rag/ingest.ts");
    const add = ingest.slice(ingest.indexOf("export async function addDocument"), ingest.indexOf("export const NOTES_FILENAME"));
    expect(add).toContain('kind: "document_added"');
    // Not for the deployment's own rendering of rows it already has.
    expect(add.indexOf("GENERATED_DOCUMENTS")).toBeLessThan(add.indexOf('kind: "document_added"'));
    expect((ingest.match(/kind: "document_added"/g) ?? []).length).toBe(1);
  });
});

describe("the ? beside the cost", () => {
  it("is a button, so a click and a keyboard both reach it", () => {
    const fn = app.slice(app.indexOf("function costLine"), app.indexOf("\n}\n", app.indexOf("function costLine")));
    expect(fn).toContain('<button type="button" class="cost-why"');
    expect(fn).toContain("aria-label=");
    // The hover text stays; it is the click that was missing.
    expect(fn).toContain('title="${h(why)}"');
    expect(css).toContain(".cost-why:hover");
    expect(css).not.toMatch(/\.cost-why \{[^}]*cursor: help/);
  });

  it("says it where it was asked, and takes it back", () => {
    const fn = app.slice(app.indexOf("function bindTurnActions"), app.indexOf("\n}\n", app.indexOf("function bindTurnActions")));
    expect(fn).toContain('turn.querySelector(".why-note")');
    expect(fn).toContain("open.remove()");
    expect(css).toContain(".why-note");
  });

  it("ends in something to do about it when there is something to do", () => {
    // "Add a Cloudflare read token in Settings" is a sentence with a place to
    // go, and the button knows which place.
    const fn = app.slice(app.indexOf("function costLine"), app.indexOf("\n}\n", app.indexOf("function costLine")));
    expect(fn).toMatch(/problem === "not_configured" \? ' data-fix="settings"'/);
    const bind = app.slice(app.indexOf("function bindTurnActions"), app.indexOf("\n}\n", app.indexOf("function bindTurnActions")));
    expect(bind).toContain("go(b.dataset.fix)");
  });
});

describe("the agent icon", () => {
  it("is the octopus, filled, in the ink around it", () => {
    const glyph = app.slice(app.indexOf("  agents:"), app.indexOf("',", app.indexOf("  agents:")));
    expect(glyph).toContain('fill="currentColor" stroke="none"');
    // Not the robot it used to be.
    expect(app).not.toContain('<rect x="3.5" y="8" width="17" height="11" rx="3.5"/>');
  });

  it("carries its own fill, because every other icon here is a stroke", () => {
    const helper = app.slice(app.indexOf("const icon = (name, size = 16)"), app.indexOf("// ----", app.indexOf("const icon = (name, size = 16)")));
    expect(helper).toContain('fill="none" stroke="currentColor"');
  });

  it("has its eyes as holes, so it stays one colour", () => {
    // Two paints would be two colours, and the rail gives it one.
    const glyph = app.slice(app.indexOf("  agents:"), app.indexOf("',", app.indexOf("  agents:")));
    expect((glyph.match(/fill=/g) ?? []).length).toBe(1);
    expect(glyph).not.toContain("#000");
  });
});

/** A D1 that answers the upsert with whatever `opened_at` the test wants. */
function fakeDb(openedAt: (stamp: string) => string | null) {
  const events: { kind: string; detail: string }[] = [];
  let lastStamp = "";
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (!sql.includes("RETURNING opened_at")) return null;
            lastStamp = String(args[args.length - 1]);
            const at = openedAt(lastStamp);
            return at === null ? null : { opened_at: at };
          },
          run: async () => {
            if (sql.startsWith("INSERT INTO event_log")) {
              events.push({ kind: String(args[2]), detail: String(args[3]) });
            }
            return {};
          },
        }),
      }),
    },
  } as never;
  return { env, events };
}

describe("opening a handover, run against a database", () => {
  const input = { conversationId: "c1", businessId: "b1", customerId: null, reason: "a wedding for 200" };

  it("says it opened one, and writes the line", async () => {
    const { openHandover } = await import("../src/db/queries.js");
    const { env, events } = fakeDb((stamp) => stamp);
    expect(await openHandover(env, input)).toBe(true);
    expect(events).toEqual([{ kind: "waiting_for_a_person", detail: "a wedding for 200" }]);
  });

  it("says nothing the second time the same customer asks", async () => {
    const { openHandover } = await import("../src/db/queries.js");
    const { env, events } = fakeDb(() => "2026-09-03T00:00:00.000Z");
    expect(await openHandover(env, input)).toBe(false);
    expect(events).toEqual([]);
  });

  it("writes the line when the platform hands nothing back", async () => {
    // Unknowable from here, and a log with a repeat in it is worth more than
    // the permanently empty panel this replaces.
    const { openHandover } = await import("../src/db/queries.js");
    const { env, events } = fakeDb(() => null);
    expect(await openHandover(env, input)).toBe(true);
    expect(events).toHaveLength(1);
  });
});
