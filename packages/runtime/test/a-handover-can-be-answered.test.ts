/**
 * A handover the shop can actually answer.
 *
 * "Someone from our team will reply here shortly" is true on Telegram, where
 * the person answers in the same thread and the customer has an address. On a
 * website it is a promise the shop cannot keep: a visitor is a browser tab, and
 * the answer written an hour later lands in a conversation nobody is looking
 * at. The customer is gone and the shop does not even know who they were.
 *
 * So where the channel carries no way back, the handover asks for the two
 * things that make the promise keepable — who they are, and where to reach
 * them — and says why it is asking. Where the channel does carry one, it does
 * not, because asking a Telegram customer for a phone number is noise.
 *
 * Which of the two is a fact about the channel, and whether it has been asked
 * already is a fact about the handover record. Neither is read off the words.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const { handoverReply } = await import("../src/answer.js");

const LOCALES = ["en", "th", "zh", "my"] as const;

describe("where a person can be reached again", () => {
  it("says one is coming, and asks for nothing", () => {
    for (const locale of LOCALES) {
      const said = handoverReply(locale, true);
      expect(said.length).toBeGreaterThan(20);
      expect(said).not.toMatch(/\?|？/);
    }
  });
});

describe("where they cannot", () => {
  it("asks who they are and how to reach them", () => {
    const said = handoverReply("en", false);
    expect(said).toContain("your name");
    expect(said).toMatch(/phone|email/);
    // And says why, rather than demanding it.
    expect(said).toContain("get back to you");
  });

  it("asks it in the language the shop answers in", () => {
    // A Thai shop falling back to an English sentence is the shop's own voice
    // breaking at the one moment it is asking a customer for something.
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      expect(handoverReply(locale, false)).not.toBe(handoverReply("en", false));
    }
    expect(handoverReply("th", false)).toContain("เบอร์โทร");
    expect(handoverReply("my", false)).toContain("ဖုန်း");
    expect(handoverReply("zh", false)).toContain("电话");
  });

  it("asks once, not on every question after it", () => {
    // A customer whose second question also needs a person has already given
    // their number, or has already declined to.
    expect(handoverReply("en", false, true)).toBe(handoverReply("en", true));
  });

  it("falls back to a sentence, never to nothing", () => {
    expect(handoverReply("pt", false).length).toBeGreaterThan(20);
    expect(handoverReply("pt", true).length).toBeGreaterThan(20);
  });
});

describe("which one each channel gets", () => {
  it("is decided by the channel, at the door", () => {
    expect(src("web/routes.ts")).toMatch(/answerQuestion\(env, \{[^}]*canReachThem: false \}\)/);
    // Telegram says nothing, and the default is the channel that has an
    // address: a new caller that forgets this asks nobody for a phone number.
    expect(src("telegram/reply.ts")).not.toContain("canReachThem");
    expect(src("answer.ts")).toMatch(/canReachThem = true/);
  });

  it("reads whether it has already asked off the record", () => {
    const answer = src("answer.ts");
    expect(answer).toMatch(/const waiting = \(await getHandover\(env, input\.conversationId\)/);
    // Not from the transcript, and not by looking for a phone number in it.
    expect(answer).not.toMatch(/history\.some|\.includes\("phone"\)|match\(\/\\d/);
  });

  it("says it on the escalation path only", () => {
    // A read on every answer would be a database call for the case that does
    // not happen.
    const answer = src("answer.ts");
    expect(answer.indexOf("const escalated = wantsHandover")).toBeLessThan(
      answer.indexOf("await getHandover(env, input.conversationId)"),
    );
  });
});
