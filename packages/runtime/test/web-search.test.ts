/**
 * Live web data, and the difference between the web and the business.
 *
 * The one door in this deployment that looks outside it. Everything an agent
 * tells a customer comes from material the owner gave it, and that stays true —
 * this is the owner's own tool, on their own key. The tests that matter here
 * are the ones about honesty at the boundary: that a search which found nothing
 * says so rather than returning something, that every row carries where it came
 * from so a price can be traced before it is copied, and that a refusal by
 * SerpApi arrives as the reason SerpApi gave rather than as a bare failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ key: null as string | null }));
vi.mock("../src/web/secrets-vault.js", () => ({
  getSecret: vi.fn(async () => vault.key),
}));

const { SearchUnavailable, isSearchKind, webSearch, webSearchConfigured, SEARCH_KINDS } = await import(
  "../src/web-search.js"
);

const env = {} as never;
const replied = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

beforeEach(() => {
  vault.key = "serp-key";
  vi.unstubAllGlobals();
});

describe("whether it can search at all", () => {
  it("is off with no key, and says where the key goes", async () => {
    vault.key = null;
    expect(await webSearchConfigured(env)).toBe(false);
    await expect(webSearch(env, { query: "chemex", kind: "web" })).rejects.toBeInstanceOf(SearchUnavailable);
    await expect(webSearch(env, { query: "chemex", kind: "web" })).rejects.toThrow(/Settings, in Web search/);
  });

  it("is on with a key", async () => {
    expect(await webSearchConfigured(env)).toBe(true);
  });

  it("refuses an empty query without spending a search", async () => {
    const fetchMock = replied({});
    vi.stubGlobal("fetch", fetchMock);
    await expect(webSearch(env, { query: "   ", kind: "web" })).rejects.toBeInstanceOf(SearchUnavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the three engines", () => {
  it("names a different SerpApi engine for each kind", () => {
    // Three questions, three engines. One engine answering all three was the
    // version where "who else is near me" came back as a list of blog posts.
    expect(new Set(Object.values(SEARCH_KINDS)).size).toBe(3);
    expect(SEARCH_KINDS.shopping).toBe("google_shopping");
    expect(SEARCH_KINDS.local).toBe("google_maps");
  });

  it("accepts only the kinds it has an engine for", () => {
    expect(isSearchKind("shopping")).toBe(true);
    expect(isSearchKind("news")).toBe(false);
  });

  it("sends the key and the engine, and keeps neither in what it returns", async () => {
    const fetchMock = replied({ organic_results: [] });
    vi.stubGlobal("fetch", fetchMock);
    const answer = await webSearch(env, { query: "chemex price", kind: "shopping" });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("engine")).toBe("google_shopping");
    expect(url.searchParams.get("api_key")).toBe("serp-key");
    // The result goes into a transcript this deployment reads back to itself
    // on every later turn. A key in there would be a credential in the history.
    expect(JSON.stringify(answer)).not.toContain("serp-key");
  });

  it("tells the maps engine what kind of search it is", async () => {
    // Without type=search the maps engine refuses the query outright, and the
    // owner is told the web returned nothing when it was never asked.
    const fetchMock = replied({ local_results: [] });
    vi.stubGlobal("fetch", fetchMock);
    await webSearch(env, { query: "cafes", kind: "local" });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("type")).toBe("search");
    await webSearch(env, { query: "chemex", kind: "shopping" });
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.has("type")).toBe(false);
  });

  it("puts a place name where each engine actually reads one", async () => {
    // The maps engine's own location parameter takes GPS coordinates, and its
    // documentation says to put the city in the query instead. Sending a place
    // name there would be silently ignored, which reads as a search that found
    // the wrong town rather than as a parameter we got wrong.
    const fetchMock = replied({ local_results: [] });
    vi.stubGlobal("fetch", fetchMock);
    await webSearch(env, { query: "cafes", kind: "local", location: "Bangkok" });
    const maps = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(maps.get("q")).toBe("cafes Bangkok");
    expect(maps.has("location")).toBe(false);

    await webSearch(env, { query: "chemex", kind: "shopping", location: "Bangkok" });
    const shopping = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(shopping.get("q")).toBe("chemex");
    expect(shopping.get("location")).toBe("Bangkok");

    await webSearch(env, { query: "chemex", kind: "shopping" });
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.has("location")).toBe(false);
  });
});

describe("what comes back", () => {
  it("keeps the seller and the link on a shopping row", async () => {
    // The whole reason this is safe to offer. A price with no seller is a
    // number the owner cannot check, and one they cannot check is one they
    // should not put on their own list.
    vi.stubGlobal(
      "fetch",
      replied({
        shopping_results: [
          { title: "Chemex 6-cup", price: "$44.95", source: "Blue Bottle", product_link: "https://x.test/1" },
        ],
      }),
    );
    const answer = await webSearch(env, { query: "chemex", kind: "shopping" });
    expect(answer.results).toEqual([
      { title: "Chemex 6-cup", price: "$44.95", source: "Blue Bottle", link: "https://x.test/1", snippet: "" },
    ]);
  });

  it("puts the address and the rating where a local row's detail goes", async () => {
    vi.stubGlobal(
      "fetch",
      replied({
        local_results: [
          { title: "Shwe Coffee", address: "12 Thonglor", type: "Cafe", rating: 4.6, reviews: 218, phone: "+66" },
        ],
      }),
    );
    const [row] = (await webSearch(env, { query: "cafe", kind: "local" })).results;
    expect(row.snippet).toBe("12 Thonglor · Cafe · 4.6★ (218)");
    expect(row.source).toBe("+66");
  });

  it("reads a direct answer from whichever box holds it", async () => {
    // Google returns the same kind of answer under three names depending on
    // the question. Reading one of them means a direct answer sometimes
    // silently becomes no answer.
    for (const body of [
      { answer_box: { answer: "42" } },
      { answer_box: { snippet: "42" } },
      { knowledge_graph: { description: "42" } },
    ]) {
      vi.stubGlobal("fetch", replied(body));
      expect((await webSearch(env, { query: "q", kind: "web" })).directAnswer).toBe("42");
    }
  });

  it("returns nothing when there was nothing, rather than a row", async () => {
    vi.stubGlobal("fetch", replied({ organic_results: [] }));
    const answer = await webSearch(env, { query: "asdkjhasd", kind: "web" });
    expect(answer.results).toEqual([]);
    expect(answer.directAnswer).toBe("");
  });
});

describe("when SerpApi says no", () => {
  it("passes the reason through instead of a bare status", async () => {
    vi.stubGlobal("fetch", replied({ error: "Invalid API key" }, 401));
    await expect(webSearch(env, { query: "q", kind: "web" })).rejects.toThrow(/Invalid API key/);
  });

  it("treats an error in a 200 body as an error", async () => {
    // SerpApi answers some refusals with a 200 and an error field. Reading
    // only the status would report "no results" for a key that has run out.
    vi.stubGlobal("fetch", replied({ error: "Your account has run out of searches" }));
    await expect(webSearch(env, { query: "q", kind: "web" })).rejects.toThrow(/run out of searches/);
  });

  it("names the cause when it could not be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timed out"); }));
    await expect(webSearch(env, { query: "q", kind: "web" })).rejects.toThrow(/could not be reached: timed out/);
  });
});
