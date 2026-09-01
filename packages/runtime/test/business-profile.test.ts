/**
 * The address and the phone number, as things the assistant can answer with.
 *
 * "Where are you?" and "what is your number?" are the two commonest questions a
 * shop is asked, and neither is in a price list or a policy document. They are
 * fields the owner filled in, so the assistant is told them plainly rather than
 * left to find them inside a paragraph.
 *
 * The half that matters most here is what is left out. A form has empty fields
 * in it; a prompt that prints "Phone:" with nothing after it is an invitation
 * to invent one.
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, renderProfile, renderRules } from "../src/answer.js";
import type { BusinessProfile, BusinessRule } from "../src/db/queries.js";

const empty: BusinessProfile = {
  kind: "",
  about: "",
  address: "",
  mapUrl: "",
  phone: "",
  email: "",
  website: "",
  facebook: "",
  hours: "",
};

const business = {
  id: "b1",
  name: "Sunrise Bakery",
  locale: "en",
  systemPrompt: "Be warm and brief.",
  model: "m1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as never;

describe("what the assistant is told about the business", () => {
  it("says nothing at all when nothing was filled in", () => {
    expect(renderProfile("Sunrise Bakery", empty)).toBe("");
    expect(renderProfile("Sunrise Bakery", null)).toBe("");
  });

  it("prints only the fields that have something in them", () => {
    const text = renderProfile("Sunrise Bakery", {
      ...empty,
      address: "12 Sukhumvit Road, Bangkok",
      phone: "02 123 4567",
    });
    expect(text).toContain("Address: 12 Sukhumvit Road, Bangkok");
    expect(text).toContain("Phone: 02 123 4567");
    // The invitation to make one up.
    expect(text).not.toContain("Email:");
    expect(text).not.toContain("Facebook:");
    expect(text).not.toContain("Map link:");
  });

  it("treats whitespace as empty, because a form gives you that", () => {
    expect(renderProfile("Sunrise Bakery", { ...empty, phone: "   " })).toBe("");
  });

  it("marks the block as the owner's own facts and closes the list", () => {
    const text = renderProfile("Sunrise Bakery", { ...empty, address: "12 Sukhumvit" });
    expect(text).toContain("<<<BUSINESS");
    expect(text).toContain("BUSINESS>>>");
    expect(text).toContain("given by the owner");
    // The sentence that stops it filling the gaps.
    expect(text).toContain("Anything not listed here is something you do not know.");
  });
});

describe("the prompt the model receives", () => {
  it("carries the profile when there is one", () => {
    const prompt = buildSystemPrompt(business, "", [], [], {
      ...empty,
      address: "12 Sukhumvit Road",
    });
    expect(prompt).toContain("12 Sukhumvit Road");
    expect(prompt).toContain("Sunrise Bakery");
  });

  it("is unchanged when there is not", () => {
    // An empty profile must not add an empty section: every line in a prompt
    // is a line the model reads.
    expect(buildSystemPrompt(business, "", [], [], empty)).toBe(
      buildSystemPrompt(business, "", [], [], null),
    );
  });
});


const rule = (over: Partial<BusinessRule>): BusinessRule => ({
  id: "r1",
  kind: "delivery",
  content: "Delivery inside Bangkok is 60 THB and takes one day.",
  active: true,
  priority: 100,
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

describe("the standing instructions", () => {
  it("says nothing when there are none", () => {
    expect(renderRules([])).toBe("");
  });

  it("leaves out a rule that was switched off", () => {
    // This is the whole reason a rule is a row and not a paragraph. If a
    // switched off rule still reached the model, the switch would be a label.
    const text = renderRules([rule({ active: false })]);
    expect(text).toBe("");
    const mixed = renderRules([
      rule({ id: "r1", active: false, content: "Old delivery price is 40 THB." }),
      rule({ id: "r2", active: true, content: "Delivery is 60 THB." }),
    ]);
    expect(mixed).toContain("60 THB");
    expect(mixed).not.toContain("40 THB");
  });

  it("leaves out a rule with nothing written in it", () => {
    expect(renderRules([rule({ content: "   " })])).toBe("");
  });

  it("names what kind of instruction each one is", () => {
    expect(renderRules([rule({ kind: "escalation", content: "Anything about a refund." })])).toContain(
      "When to stop and fetch a person: Anything about a refund.",
    );
  });

  it("keeps them in the order the owner gave", () => {
    const text = renderRules([
      rule({ id: "r1", content: "First." }),
      rule({ id: "r2", content: "Second." }),
    ]);
    expect(text.indexOf("First.")).toBeLessThan(text.indexOf("Second."));
  });

  it("reaches the prompt, and adds nothing when empty", () => {
    expect(buildSystemPrompt(business, "", [], [], null, [rule({})])).toContain("60 THB");
    expect(buildSystemPrompt(business, "", [], [], null, [])).toBe(
      buildSystemPrompt(business, "", [], [], null),
    );
  });
});
