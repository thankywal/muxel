/**
 * The assistant may ask, and it may build — but not with a secret in its hands.
 *
 * Making an agent takes several pieces and the owner has them, so the model
 * asks for one at a time and the loop stops there: a question is not work, and
 * the owner's reply is what starts the next turn. Making the thing is a write
 * like any other, described on a card the owner says yes to.
 *
 * The one thing that never travels through the model is a Telegram bot token.
 * It is a credential, and this deployment reads its own transcript back to
 * itself on every later turn, so a token that arrived in a message would be
 * re-read forever. The tool opens a field in the owner's browser instead, and
 * the value goes from there to their own deployment.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findTool, TOOLS, ASK_OWNER } from "../src/assistant/tools.js";

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const loop = src("assistant/loop.ts");

describe("asking", () => {
  it("offers a question as a tool, so the model can ask instead of guessing", () => {
    const tool = findTool(ASK_OWNER);
    expect(tool?.writes).toBe(false);
    expect(tool?.parameters).toHaveProperty("properties.choices");
  });

  it("stops the loop on a question rather than running it", () => {
    // Running it would mean the loop carried on and answered its own question,
    // which is what it used to do: it wrote the question into the reply and
    // then treated the reply as finished.
    const asked = loop.indexOf(`tool.name === ASK_OWNER`);
    expect(asked).toBeGreaterThan(-1);
    expect(loop.slice(asked, asked + 700)).toMatch(/prompt = \{[\s\S]*kind: "question"/);
    expect(loop.slice(asked, asked + 700)).toContain("break;");
  });

  it("keeps the question, so reopening the chat still offers the answers", () => {
    expect(loop).toMatch(/recordPrompt\(env, answerId/);
  });
});

describe("the bot token", () => {
  it("is never a thing the model is given", () => {
    // No tool takes one. The one that starts the connection takes the business
    // and nothing else.
    for (const tool of TOOLS) {
      const properties = Object.keys(
        (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {},
      );
      expect(properties, tool.name).not.toContain("token");
    }
    expect(Object.keys(
      (findTool("connect_telegram")?.parameters as { properties: Record<string, unknown> }).properties,
    )).toEqual(["business_id"]);
  });

  it("stops the loop so a person can type it, and changes nothing itself", () => {
    expect(findTool("connect_telegram")?.writes).toBe(false);
    const at = loop.indexOf('tool.name === "connect_telegram"');
    expect(at).toBeGreaterThan(-1);
    expect(loop.slice(at, at + 500)).toMatch(/kind: "telegram_token"/);
  });

  it("is collected by the console and sent straight to the deployment", () => {
    // Not by putting it in a message. The console posts it to the same route
    // the Channels page uses, and only tells the assistant that it worked.
    const app = readFileSync(
      new URL("../../console/public/app.js", import.meta.url),
      "utf8",
    );
    expect(app).toMatch(/businesses\/\$\{encodeURIComponent\(businessId\)\}\/telegram/);
    const at = app.indexOf("async function connectTelegramFromChat");
    expect(app.slice(at, at + 1200)).not.toMatch(/asText"\)\.value = [^;]*value/);
  });
});

describe("building", () => {
  it("creates a business the same way the console does", () => {
    // A second way to make one is a second set of defaults to keep in step.
    const tools = src("assistant/tools.ts");
    const at = tools.indexOf('name: "create_business"');
    const body = tools.slice(at, tools.indexOf('name: "delete_business"'));
    for (const call of ["createBusiness(", "saveProfile(", "createChannel("]) {
      expect(body, call).toContain(call);
    }
  });

  it("asks before it writes anything down", () => {
    // The fields are the owner's to give. A model that filled in an address it
    // was never told would be writing fiction into a customer's answer.
    expect(findTool("create_business")?.writes).toBe(true);
    expect(findTool("create_business")?.summarise?.({ name: "Sunrise Bakery" })).toContain(
      "Sunrise Bakery",
    );
    // And the tool's own description says where those fields come from.
    expect(src("assistant/tools.ts")).toContain("invent an address");
  });

  it("tells the model to do it a piece at a time", () => {
    expect(loop).toMatch(/ask_owner for the one thing you need next/);
  });
});
