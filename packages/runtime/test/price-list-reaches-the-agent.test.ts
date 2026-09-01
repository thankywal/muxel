/**
 * A price the operator types must be a price the assistant can quote.
 *
 * The web console's price list read and wrote the `product` table. Nothing else
 * in this project touches that table: the assistant answers from
 * `productsView`, which is what was extracted from the uploaded documents with
 * the owner's corrections laid over it, and a correction only reaches the
 * assistant once it has been written into the owner-updates document and
 * re-indexed.
 *
 * So an operator could add an item in the web console, see it appear in the
 * table, and the agent would go on saying it did not know that price. Silent,
 * and indistinguishable from success, which is the worst shape a bug can take.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const corrections: unknown[] = [];
const synced: string[] = [];

vi.mock("../src/rag/ingest.js", () => ({
  syncOwnerUpdates: vi.fn(async (_env: unknown, businessId: string) => {
    synced.push(businessId);
  }),
}));

const { saveProductEntry } = await import("../src/products.js");

/** Enough of a D1 to record the write without running SQL. */
const env = {
  DB: {
    prepare: () => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          corrections.push(values);
        },
      }),
    }),
  },
} as never;

beforeEach(() => {
  corrections.length = 0;
  synced.length = 0;
});

describe("saving one item", () => {
  it("records the correction and makes the assistant able to read it", async () => {
    await saveProductEntry(env, {
      businessId: "b1",
      name: "Chocolate cake, 1 lb",
      price: "450 THB",
      description: "Serves 6 to 8.",
      removed: false,
    });
    expect(corrections).toHaveLength(1);
    // The second half is the half that was forgotten. Without it the price is
    // stored and the assistant still quotes the old one.
    expect(synced).toEqual(["b1"]);
  });

  it("re-indexes on a removal too", async () => {
    await saveProductEntry(env, {
      businessId: "b1",
      name: "Croissant",
      price: "",
      description: "",
      removed: true,
    });
    expect(synced).toEqual(["b1"]);
  });
});

describe("who writes the price list", () => {
  const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

  it("leaves the table nothing reads alone", () => {
    // `product` is written and read by db/queries.ts and by nobody else. A call
    // to it from anywhere in the console or the reply path is an item going
    // somewhere the assistant will never look.
    for (const path of ["web/console-api.ts", "telegram/admin.ts", "answer.ts"]) {
      const text = src(path);
      expect(text, path).not.toContain("listProducts(");
      expect(text, path).not.toContain("createProduct(");
      expect(text, path).not.toContain("deleteProduct(");
    }
  });

  it("unindexes a document it deletes, through the one door that does both", () => {
    // deleteDocument drops the row and hands back the chunk ids for the caller
    // to remove from the index. The web console called it and threw them away,
    // so a removed price list kept being retrieved and quoted. removeDocument
    // is the door that does both, and it is the only caller of the other.
    for (const path of ["web/console-api.ts", "telegram/admin.ts"]) {
      expect(src(path), path).not.toContain("deleteDocument(");
    }
    expect(src("rag/ingest.ts")).toContain("await env.KNOWLEDGE.deleteByIds(ids)");
  });

  it("puts the two writes in one function rather than at every call site", () => {
    // They were written out longhand three times, which is three chances to
    // forget and one that already had been.
    for (const path of ["web/console-api.ts", "telegram/admin.ts"]) {
      expect(src(path), path).not.toContain("upsertCorrection(");
      expect(src(path), path).not.toContain("syncOwnerUpdates(");
    }
    expect(src("products.ts")).toContain("export async function saveProductEntry");
  });
});
