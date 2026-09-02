/**
 * A confidence is a fact, and an absent one is not a high one.
 *
 * The reason for reading a document through Nutrient DWS rather than by asking
 * a language model to read the prose it was flattened into is that DWS says how
 * sure it is, per field. That number is the whole value: it turns forty rows
 * that all look equally certain into three the owner should read carefully and
 * thirty-seven they need not.
 *
 * Which makes every way of quietly inventing one a bug worth a test. A row with
 * no confidence must come back as null and never as 1, a row is only as sure as
 * its least sure field, and a refusal must arrive as the reason DWS gave — an
 * exhausted credit balance reported as "no items" is a document the owner is
 * told is empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ key: null as string | null }));
vi.mock("../src/web/secrets-vault.js", () => ({
  getSecret: vi.fn(async () => vault.key),
}));

const { ExtractionUnavailable, documentDataConfigured, readDocumentData, UNSURE_BELOW } = await import(
  "../src/rag/nutrient.js"
);

const env = {} as never;
const file = { bytes: new ArrayBuffer(8), filename: "prices.pdf", contentType: "application/pdf" };
const replied = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

beforeEach(() => {
  vault.key = "dws-key";
  vi.unstubAllGlobals();
});

describe("whether it can read a document as data", () => {
  it("is off with no key, and says where the key goes", async () => {
    vault.key = null;
    expect(await documentDataConfigured(env)).toBe(false);
    await expect(readDocumentData(env, file)).rejects.toBeInstanceOf(ExtractionUnavailable);
    await expect(readDocumentData(env, file)).rejects.toThrow(/Settings, in Document data/);
  });

  it("is on with a key, and sends it as a bearer with the file", async () => {
    const fetchMock = replied({ items: [] });
    vi.stubGlobal("fetch", fetchMock);
    expect(await documentDataConfigured(env)).toBe(true);
    await readDocumentData(env, file);
    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer dws-key");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(Blob);
  });

  it("asks for the confidences rather than hoping for them", async () => {
    const fetchMock = replied({ items: [] });
    vi.stubGlobal("fetch", fetchMock);
    await readDocumentData(env, file);
    const sent = JSON.parse(String(((fetchMock.mock.calls[0][1] as RequestInit).body as FormData).get("data")));
    expect(sent.includeConfidence).toBe(true);
    expect(sent.schema.properties.items.items.properties).toHaveProperty("price");
  });
});

describe("the confidence on a row", () => {
  const withScores = (items: unknown[], confidence: unknown) =>
    replied({ data: { items, confidence } });

  it("is null when DWS gave none, not a one", async () => {
    // The failure this whole file exists to prevent. Defaulting an unknown
    // confidence to certain turns "we do not know" into "we are sure", which
    // is exactly the row the owner needed to look at.
    vi.stubGlobal("fetch", replied({ items: [{ name: "Batch Brew", price: "4.00" }] }));
    const read = await readDocumentData(env, file);
    expect(read.items[0].confidence).toBeNull();
    expect(read.unsure).toBe(0);
  });

  it("is null when the confidence object holds no field we recognise", async () => {
    // A shape we do not understand is not a shape we are confident about. This
    // is the quiet version of the same failure: DWS renames its fields, every
    // row silently becomes certain, and the owner stops being shown which ones
    // to check without anything appearing to have broken.
    vi.stubGlobal("fetch", withScores([{ name: "A" }], [{ somethingElse: 0.9 }]));
    expect((await readDocumentData(env, file)).items[0].confidence).toBeNull();
  });

  it("is the weakest field, not the average", async () => {
    // A name read perfectly beside a price that was a guess is not a confident
    // row: the price is the part that goes on the price list.
    vi.stubGlobal("fetch", withScores([{ name: "Chemex", price: "11.00" }], [{ name: 0.99, price: 0.4 }]));
    expect((await readDocumentData(env, file)).items[0].confidence).toBe(0.4);
  });

  it("reads a percentage as a proportion", async () => {
    vi.stubGlobal("fetch", withScores([{ name: "Siphon" }], [{ name: 82 }]));
    expect((await readDocumentData(env, file)).items[0].confidence).toBe(0.82);
  });

  it("takes a plain number beside the row, and one inside it", async () => {
    vi.stubGlobal("fetch", withScores([{ name: "A" }], [0.55]));
    expect((await readDocumentData(env, file)).items[0].confidence).toBe(0.55);
    vi.stubGlobal("fetch", replied({ items: [{ name: "A", confidence: 0.6 }] }));
    expect((await readDocumentData(env, file)).items[0].confidence).toBe(0.6);
  });

  it("counts the unsure rows once, so every reader agrees", async () => {
    // The tool, the model's words and anything drawn from this all need the
    // same number. Counting it in three places is how the card says two and
    // the sentence above it says three.
    vi.stubGlobal(
      "fetch",
      withScores(
        [{ name: "A" }, { name: "B" }, { name: "C" }],
        [{ name: 0.99 }, { name: 0.2 }, { name: 0.5 }],
      ),
    );
    const read = await readDocumentData(env, file);
    expect(UNSURE_BELOW).toBeGreaterThan(0.5);
    expect(read.unsure).toBe(2);
  });
});

describe("what it makes of the reply", () => {
  it("reads the rows whether they are wrapped or not", async () => {
    // A payload merely arranged differently must not be reported as a document
    // with nothing in it — that failure looks exactly like an empty file.
    for (const body of [
      { items: [{ name: "A" }] },
      { data: { items: [{ name: "A" }] } },
      { result: { items: [{ name: "A" }] } },
    ]) {
      vi.stubGlobal("fetch", replied(body));
      expect((await readDocumentData(env, file)).items).toHaveLength(1);
    }
  });

  it("drops a row with no name and keeps the rest", async () => {
    vi.stubGlobal("fetch", replied({ items: [{ price: "4.00" }, { name: "B", price: "5" }] }));
    const read = await readDocumentData(env, file);
    expect(read.items.map((item) => item.name)).toEqual(["B"]);
  });

  it("passes on the reason DWS refused, not the status alone", async () => {
    vi.stubGlobal("fetch", replied({ error: "Insufficient credits" }, 402));
    await expect(readDocumentData(env, file)).rejects.toThrow(/Insufficient credits/);
  });

  it("says so when the reply was not JSON at all", async () => {
    vi.stubGlobal("fetch", replied("<html>gateway</html>"));
    await expect(readDocumentData(env, file)).rejects.toThrow(/not JSON/);
  });

  it("names the cause when DWS could not be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    await expect(readDocumentData(env, file)).rejects.toThrow(/could not be reached: socket hang up/);
  });
});
