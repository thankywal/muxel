import { describe, expect, it } from "vitest";

import { HANDOVER_SENTINEL, stripSentinel, wantsHandover } from "../src/escalation.js";

/**
 * The sentinel is how the assistant asks for a person. Missing one means a
 * customer is told nothing is coming; seeing one that is not there means an
 * ordinary answer is replaced by a promise of a callback. Both are worse than
 * the question that triggered them, so the boundary is pinned here.
 */

describe("wantsHandover", () => {
  it("recognises the sentinel alone", () => {
    expect(wantsHandover(HANDOVER_SENTINEL)).toBe(true);
  });

  it("recognises it when the model wrapped it in prose", () => {
    expect(wantsHandover(`I am not sure. ${HANDOVER_SENTINEL}`)).toBe(true);
  });

  it("leaves an ordinary answer alone", () => {
    expect(wantsHandover("We open at 9am.")).toBe(false);
  });

  it("does not fire on an answer that merely mentions a person", () => {
    // Phrase matching would have escalated this one, and it is a real answer.
    expect(wantsHandover("Our delivery person arrives before noon.")).toBe(false);
  });

  it("does not fire on a Burmese answer that declines politely", () => {
    // The reason for a sentinel rather than phrase detection: the assistant
    // replies in the customer's language, and no phrase list covers them all.
    expect(wantsHandover("ဒီအကြောင်း ကျွန်တော် မသိပါဘူး")).toBe(false);
  });
});

describe("stripSentinel", () => {
  it("leaves nothing behind when the sentinel was the whole reply", () => {
    expect(stripSentinel(HANDOVER_SENTINEL)).toBe("");
  });

  it("keeps the prose and removes the marker", () => {
    expect(stripSentinel(`Let me check that. ${HANDOVER_SENTINEL}`)).toBe("Let me check that.");
  });

  it("removes every occurrence, so none reaches the customer", () => {
    const answer = `${HANDOVER_SENTINEL} hmm ${HANDOVER_SENTINEL}`;
    expect(stripSentinel(answer)).toBe("hmm");
    expect(stripSentinel(answer)).not.toContain("[[");
  });
});
