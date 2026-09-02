/**
 * Every change one answer proposed, in one card.
 *
 * A turn that proposed a business and its ten prices produced eleven separate
 * boxes down the thread, and an owner scrolled looking for the end of them.
 * It is one card now: the count in the header, a row per change with a Yes/No
 * switch, and one control that answers all of them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateConsole } from "./console-harness.js";

const { approvalCard } = evaluateConsole();
const app = readFileSync(new URL("../../console/public/app.js", import.meta.url), "utf8");

const change = (id: string, state: string, summary: string) => ({
  id,
  messageId: "m2",
  tool: "save_price",
  args: { business_id: "b1", name: summary, price: "4.00" },
  summary,
  state,
  result: state === "failed" ? "That business is not one you can see." : "",
  createdAt: "2026-09-02T00:00:00.000Z",
});

describe("the card", () => {
  it("holds every change in one box", () => {
    const html = approvalCard([
      change("a1", "waiting", "Batch Brew"),
      change("a2", "waiting", "Pour Over"),
      change("a3", "waiting", "Siphon Brew"),
    ]);
    expect((html.match(/class="changes"/g) ?? []).length).toBe(1);
    expect((html.match(/class="change /g) ?? []).length).toBe(3);
    expect(html).toContain("3 changes waiting for you");
  });

  it("gives each waiting change a switch, and each settled one its outcome", () => {
    const html = approvalCard([
      change("a1", "waiting", "Batch Brew"),
      change("a2", "approved", "Pour Over"),
      change("a3", "failed", "Siphon Brew"),
    ]);
    expect((html.match(/data-approve=/g) ?? []).length).toBe(2); // Yes and No, on the one waiting
    expect(html).toContain('data-approve="a1" data-yes="1"');
    expect(html).not.toContain('data-approve="a2"');
    expect(html).toContain("Done");
    // A failure says why, rather than just failing.
    expect(html).toContain("not one you can see");
  });

  it("offers one answer for all of them only when there is more than one", () => {
    expect(approvalCard([change("a1", "waiting", "Batch Brew")])).not.toContain('id="allYes"');
    expect(
      approvalCard([change("a1", "waiting", "A"), change("a2", "waiting", "B")]),
    ).toContain('id="allYes"');
  });

  it("counts only what is still waiting in its header", () => {
    const html = approvalCard([change("a1", "waiting", "A"), change("a2", "approved", "B")]);
    expect(html).toContain("1 change waiting for you");
  });
});

describe("saying yes to all of them", () => {
  const body = app.slice(app.indexOf("async function approveAll"), app.indexOf("// ------", app.indexOf("async function approveAll")));

  it("asks first, and says how many", () => {
    expect(body).toMatch(/await ask\(/);
    expect(body).toMatch(/Say yes to \$\{waiting\.length\} changes/);
  });

  it("runs them one at a time, so one failure does not stop the rest", () => {
    expect(body).toMatch(/for \(const \[index, approval\] of waiting\.entries\(\)\)/);
    expect(body).toMatch(/assistant\/approvals\/\$\{approval\.id\}/);
  });

  it("keeps the two meanings of ok apart", () => {
    // The outer one is whether the deployment answered. `data.ok` is whether
    // the change was made — and a change that could not be made comes back as
    // a perfectly good HTTP 200. Reading only the outer one reported every
    // refusal as a success.
    expect(body).toMatch(/if \(data\.ok === false\)/);
    expect(body).toMatch(/if \(!ok\) \{[\s\S]{0,160}did not answer/);
  });

  it("counts up while it runs, so a long one does not look frozen", () => {
    // Twenty five writes take long enough that a disabled, silent card reads
    // as a button that did nothing.
    expect(body).toMatch(/\$\{index \+ 1\} of \$\{waiting\.length\}/);
  });

  it("says what was made and what was not, with a reason", () => {
    expect(body).toMatch(/`Done\. \$\{made\} made\.`/);
    expect(body).toMatch(/\$\{made\} made, \$\{refused\.length\} not: \$\{refused\[0\]\}/);
  });
});

describe("saying yes to one of them", () => {
  const body = app.slice(app.indexOf("async function answerApproval"), app.indexOf("// ------", app.indexOf("async function answerApproval")));

  it("keeps the same two meanings apart", () => {
    expect(body).toMatch(/if \(!ok\) \{[\s\S]{0,120}did not answer/);
  });

  it("does not wipe the list when the answer carried none", () => {
    expect(body).toMatch(/if \(data\.approvals\) state\.assistant = /);
  });
});
