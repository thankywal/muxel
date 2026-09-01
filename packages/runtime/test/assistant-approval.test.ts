/**
 * The model does not make changes. It asks for them.
 *
 * A read runs the moment it is asked for: looking something up changes nothing,
 * and asking permission to look would make the assistant useless. A write is
 * never run by the loop at all. It becomes a card describing exactly what would
 * change, and the owner's yes is what runs it.
 *
 * That has to be a property of each tool rather than a decision the loop makes,
 * so a tool added later cannot arrive without one. These hold both halves: that
 * every write declares itself, and that the loop is told plainly nothing has
 * happened, so it cannot report a success to the owner that did not occur.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TOOLS, TOOL_SPECS, findTool } from "../src/assistant/tools.js";

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("every tool says whether it changes anything", () => {
  it("declares writes explicitly, one way or the other", () => {
    for (const tool of TOOLS) {
      expect(typeof tool.writes, tool.name).toBe("boolean");
    }
  });

  it("gives every write a sentence describing it", () => {
    // The card is the only thing the owner reads before saying yes. A write
    // with no summary would ask them to approve its function name.
    for (const tool of TOOLS.filter((t) => t.writes)) {
      expect(typeof tool.summarise, tool.name).toBe("function");
      expect(tool.summarise?.({}), tool.name).toBeTypeOf("string");
    }
  });

  it("marks as writes exactly the things that change something", () => {
    const writes = TOOLS.filter((t) => t.writes).map((t) => t.name).sort();
    expect(writes).toEqual([
      "delete_note",
      "delete_rule",
      "remove_price",
      "save_note",
      "save_price",
      "save_profile",
      "save_rule",
      "set_features",
      "set_model",
      "set_persona",
    ]);
    // And nothing that only looks is marked as one.
    for (const name of ["list_businesses", "get_business", "search_knowledge", "read_conversation"]) {
      expect(findTool(name)?.writes, name).toBe(false);
    }
  });

  it("offers the model exactly the tools that exist", () => {
    expect(TOOL_SPECS.map((spec) => spec.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const spec of TOOL_SPECS) {
      expect(spec.description.length, spec.name).toBeGreaterThan(20);
      expect(spec.parameters, spec.name).toHaveProperty("type", "object");
    }
  });
});

describe("what the loop does with a write", () => {
  const loop = src("assistant/loop.ts");

  it("parks it instead of running it", () => {
    // The branch on tool.writes has to come before anything calls run().
    const parked = loop.indexOf("if (tool.writes)");
    const ran = loop.indexOf("await tool.run(ctx, call.args)");
    expect(parked).toBeGreaterThan(-1);
    expect(ran).toBeGreaterThan(parked);
  });

  it("tells the model nothing has happened", () => {
    // Saying the change was made would have it report a success to the owner
    // that has not occurred, which is the failure this design exists against.
    expect(loop).toContain("Not done.");
    expect(loop).toContain("do not say it has been made");
  });
});

describe("what happens on a yes", () => {
  const decide = src("assistant/decide.ts");

  it("moves the row out of waiting before it runs", () => {
    // Two yeses arriving together must not run the same write twice.
    const claimed = decide.indexOf('settleApproval(env, userId, approvalId, "approved", "")');
    const ran = decide.indexOf("await tool.run(ctx, approval.args)");
    expect(claimed).toBeGreaterThan(-1);
    expect(ran).toBeGreaterThan(claimed);
    expect(decide).toContain("if (!claimed)");
  });

  it("marks a change that threw as failed, not as approved", () => {
    // An approved row that did not run is a change the owner believes they made.
    expect(decide).toContain("state = 'failed'");
  });

  it("looks the tool up again rather than trusting the card", () => {
    expect(decide).toContain("findTool(approval.tool)");
    expect(decide).toContain("!tool.writes");
  });
});
