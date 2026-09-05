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
      "add_file_to_business",
      "create_business",
      "delete_business",
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
    // Nor the two that change nothing by themselves. Asking a question is not
    // work, and connect_telegram only opens a field in the owner's browser:
    // the token goes from them to their deployment and never through here.
    for (const name of ["ask_owner", "connect_telegram"]) {
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
    //
    // It used to open with "Not done.", and this used to check for those two
    // words. They were the problem: a small model read them as a failure and
    // answered by calling the same tool again, so six prices came back as
    // twelve cards. The guarantee is unchanged and is what is checked here,
    // on the joined literals rather than on one line of source.
    const from = loop.indexOf("if (tool.writes)");
    // Comments stripped first. The comment explaining why "Not done." was
    // removed contains those words, and a check that reads them is checking
    // the explanation rather than the code.
    const parked = loop
      .slice(from, loop.indexOf("if (tool.name === ASK_OWNER)", from))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const words = [...parked.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join("");
    expect(words).toContain("it has not been made yet");
    expect(words).toContain("do not say it has been made");
    // And it no longer reads as a failure to be retried.
    expect(words).not.toContain("Not done.");
    expect(words).toContain("This call succeeded");
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

describe("what the assistant is told Muxel is", () => {
  const loop = src("assistant/loop.ts");

  it("describes the product, so it does not answer from chatbots in general", () => {
    // Without this it told owners about dashboards that do not exist. Every
    // claim below is a fact about this codebase; one that stops being true is a
    // line to change, not a line to soften.
    for (const fact of [
      "Telegram",
      "Cloudflare account",
      "price list",
      "10,000 neurons",
    ]) {
      expect(loop, fact).toContain(fact);
    }
  });

  it("denies only capabilities no tool actually provides", () => {
    // The prompt tells the owner what Muxel cannot do. If a tool for one of
    // those ever arrives, the prompt becomes a lie the model repeats, and this
    // is where that is caught. Web search has been on this list, then off it,
    // and is now on it again: the product changed twice and the line followed
    // both times. The law did not move.
    const denied = { email: /mail/, payment: /(pay|charge|invoice)/, browsing: /(search_web|web_search|browse)/ };
    expect(loop).toMatch(/does not send email/);
    expect(loop).toMatch(/does not take payments/);
    expect(loop).toMatch(/does not browse/);
    for (const [what, pattern] of Object.entries(denied)) {
      const offending = TOOLS.filter((tool) => pattern.test(tool.name)).map((tool) => tool.name);
      expect(offending, what).toEqual([]);
    }
  });

  it("reaches nothing outside the deployment, and says so without a condition", () => {
    // There were two capabilities here that left the owner's account, each
    // switched on by a key they added, so the prompt had to be built per turn
    // from the vault. Both are gone. What replaces that machinery is a plain
    // sentence, and a sentence cannot disagree with a tool that is not there.
    expect(loop).toMatch(/reaches nothing outside this deployment at all/);
    expect(loop).not.toMatch(/capability\./);
    expect(loop).not.toMatch(/SerpApi|Nutrient/);
    // Every tool a turn can call is a read or a write inside this deployment.
    const outside = TOOLS.filter((tool) => /search_web|web_search|document_data|fetch_url/.test(tool.name));
    expect(outside.map((tool) => tool.name)).toEqual([]);
  });
});
