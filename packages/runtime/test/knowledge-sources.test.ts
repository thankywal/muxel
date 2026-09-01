/**
 * Everything the assistant can draw on, and how it gets there.
 *
 * Two things reach it as documents without ever having been a file: the price
 * corrections and the owner's typed notes. Each is rows in a table so a line
 * can be edited on its own, rendered wholesale into one document, and indexed
 * through the same door as an upload.
 *
 * The rendering is where a source can quietly say something it does not mean, so
 * that is what is pinned here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GENERATED_DOCUMENTS, NOTES_FILENAME, renderNotes } from "../src/rag/ingest.js";
import { OWNER_UPDATES_FILENAME } from "../src/rag/extract.js";

describe("the notes document", () => {
  it("is nothing at all when there are no notes", () => {
    expect(renderNotes([])).toBe("");
  });

  it("skips a note with a heading and no body", () => {
    // A heading on its own is an invitation to answer from nothing: retrieval
    // would match "Delivery areas" and hand the model a title.
    expect(renderNotes([{ title: "Delivery areas", body: "" }])).toBe("");
    expect(renderNotes([{ title: "Delivery areas", body: "   " }])).toBe("");
  });

  it("keeps the heading with the body, so either can be matched", () => {
    const text = renderNotes([{ title: "Delivery areas", body: "Bangkok next day." }]);
    expect(text).toContain("## Delivery areas");
    expect(text).toContain("Bangkok next day.");
  });

  it("writes a note that has no title as plain text, not an empty heading", () => {
    const text = renderNotes([{ title: "", body: "Closed on Songkran." }]);
    expect(text).toContain("Closed on Songkran.");
    expect(text).not.toContain("## ");
  });

  it("says whose words these are", () => {
    // The assistant is told the same thing about every source: where it came
    // from. An unattributed block reads as its own reasoning.
    expect(renderNotes([{ title: "", body: "x" }])).toContain("Notes from the shop owner.");
  });
});

const ingestSrc = readFileSync(new URL("../src/rag/ingest.ts", import.meta.url), "utf8");

describe("the documents nobody uploaded", () => {
  it("names both of them in one list", () => {
    // Adding a third generated kind should be one entry here, not a search for
    // every place that rebuilds or filters.
    expect([...GENERATED_DOCUMENTS]).toEqual([OWNER_UPDATES_FILENAME, NOTES_FILENAME]);
  });

  it("reads a file in and reads its price list out in one act", () => {
    // These always happen together and were written out at one call site and
    // forgotten at the other, so a price list uploaded from the web console was
    // searchable straight away and produced no items for up to an hour.
    expect(ingestSrc).toContain("export async function addDocument");
    expect(ingestSrc).toContain("runExtraction(");
    for (const path of ["web/console-api.ts", "telegram/admin.ts"]) {
      const text = readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
      expect(text, path).not.toContain("ingestDocument(");
    }
  });

  it("rebuilds each one through the same replacement", () => {
    const src = ingestSrc;
    // Removed before it is written, and removal is what takes the vectors with
    // it. A rebuild that only added would leave the old answer retrievable.
    expect(src).toContain("async function replaceGenerated");
    expect((src.match(/replaceGenerated\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("await removeDocument(env, businessId, existing)");
  });
});
