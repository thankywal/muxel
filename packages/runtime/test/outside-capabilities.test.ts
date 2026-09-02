/**
 * The two places this deployment reaches outside itself, and the promise around
 * them.
 *
 * Everything else Muxel does happens inside the owner's own Cloudflare account,
 * and the front page says so. These two do not: a search leaves for SerpApi, and
 * a document read as data leaves for Nutrient. That is a real difference and the
 * product is only honest about it if three things hold, so they are held here.
 *
 *   Off until the owner turns it on. Not a default, not a trial, not "we tried
 *   and it failed" — no key means no capability, and the console and the
 *   assistant both say the same thing about it.
 *
 *   One record. The vault answers "is there a key"; the prompt, the tool and
 *   the settings panel are all views of that one answer. Two readers that can
 *   disagree is how a model offers a search that then refuses.
 *
 *   Said plainly. The panel that collects a key says what leaves the owner's
 *   account when it is set, in words, before they paste anything.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TOOLS } from "../src/assistant/tools.js";
import { SECRET_NAMES } from "../src/web/secrets-vault.js";
import { evaluateConsole } from "./console-harness.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const api = read("../src/web/console-api.ts");
const app = read("../../console/public/app.js");
const loop = read("../src/assistant/loop.ts");
const search = read("../src/web-search.ts");
const nutrient = read("../src/rag/nutrient.ts");

describe("the keys are the owner's", () => {
  it("keeps both in the vault that seals with the deployment's own key", () => {
    expect(SECRET_NAMES).toContain("serpapi_key");
    expect(SECRET_NAMES).toContain("nutrient_key");
  });

  it("has no route that reads a key back out", () => {
    // The console shows that a key is set and never the key. A GET here would
    // put a credential on a screen that gets shared and screenshotted.
    const route = api.slice(api.indexOf('segments[1] === "serpapi_key"'), api.indexOf('if (method === "POST" && segments[0] === "update")'));
    expect(route).toContain('method === "PUT"');
    expect(route).toContain('method === "DELETE"');
    expect(route).not.toContain("getSecret");
  });

  it("reports only whether they are set, never what they are", () => {
    const system = api.slice(api.indexOf('segments[0] === "system"'), api.indexOf('segments[1] === "github_token"'));
    expect(system).toContain('hasSecret(env, "serpapi_key")');
    expect(system).toContain('hasSecret(env, "nutrient_key")');
    expect(system).not.toContain('getSecret(env, "serpapi_key")');
    expect(system).not.toContain('getSecret(env, "nutrient_key")');
  });

  it("checks a key with the service before storing it", () => {
    // A key that does not work is found while the owner is still looking at
    // the field they typed it into, not as a tool refusing three days later.
    expect(api).toContain("async function probeKey");
    expect(api).toContain("serpapi.com/account.json");
    expect(api).toContain("api.nutrient.io/extraction/extract");
    // A service that is merely unreachable is not a rejection. Refusing the
    // key then would send the owner hunting for a mistake they did not make.
    const probe = api.slice(api.indexOf("async function probeKey"));
    expect(probe).toMatch(/status === 401 \|\| response\.status === 403/);
    expect(probe).toMatch(/catch \{\s*\n\s*return null;/);
  });
});

describe("off until it is on", () => {
  it("asks the vault, in one place each, and nowhere else", () => {
    // The tool and the prompt must get the same answer. They do because there
    // is one function per capability and both call it.
    expect(search).toContain("export async function webSearchConfigured");
    expect(nutrient).toContain("export async function documentDataConfigured");
    expect(loop).toContain("webSearchConfigured(env)");
    expect(loop).toContain("documentDataConfigured(env)");
  });

  it("refuses with the setting named, rather than with an empty result", () => {
    // An empty list reads as "nothing found", which is a lie about the world.
    // The owner needs to be told the capability is off and where to switch it.
    expect(search).toMatch(/Settings, in Web search/);
    expect(nutrient).toMatch(/Settings, in Document data/);
    expect(search).toContain("class SearchUnavailable");
    expect(nutrient).toContain("class ExtractionUnavailable");
  });

  it("tells the model which of the two it actually has", () => {
    const about = loop.slice(loop.indexOf("function aboutMuxel"), loop.indexOf("export interface Capabilities"));
    expect(about).toContain("capability.webSearch");
    expect(about).toContain("capability.documentData");
    expect(about).toMatch(/web_search is off, because no SerpApi key/);
    expect(about).toMatch(/read_document_data is off, because no Nutrient DWS key/);
  });
});

describe("the two tools", () => {
  const named = (name: string) => TOOLS.find((tool) => tool.name === name);

  it("are reads, so nothing about them needs approving", () => {
    // Looking something up changes nothing. What follows from what they find —
    // a price on the price list — is a write and still a card the owner taps.
    for (const name of ["web_search", "read_document_data"]) {
      expect(named(name), name).toBeDefined();
      expect(named(name)?.writes, name).toBe(false);
    }
  });

  it("tell the model that what they return is not the business's own", () => {
    // The one thing that makes live web data safe next to a price list: the
    // model has to know which of the two it is repeating.
    expect(named("web_search")?.description).toMatch(/not from this business/);
    expect(named("web_search")?.description).toMatch(/where it came from/);
  });

  it("can be reached: a document id comes back with the documents", () => {
    // read_document_data takes an id, and get_business is the only place one
    // could come from. Listing documents by filename alone would leave the
    // model naming a document it had no way to ask for.
    const tools = read("../src/assistant/tools.ts");
    const business = tools.slice(tools.indexOf('name: "get_business"'), tools.indexOf('name: "search_knowledge"'));
    expect(business).toMatch(/id: d\.id/);
    expect(business).toMatch(/original_kept/);
  });

  it("says the original was not kept rather than reading the wrong thing", () => {
    const tools = read("../src/assistant/tools.ts");
    const tool = tools.slice(tools.indexOf('name: "read_document_data"'), tools.indexOf('name: "list_waiting"'));
    expect(tool).toMatch(/objectKey\.length === 0/);
    expect(tool).toMatch(/was not kept/);
  });
});

describe("the archive can be found again", () => {
  it("records the key it wrote, and only after writing it", () => {
    // The bucket was written under a fresh random id that was recorded
    // nowhere, so the bytes were kept and could not be found — the document
    // row has always had an object_key column and it was always stored empty.
    const ingest = read("../src/rag/ingest.ts");
    const put = ingest.slice(ingest.indexOf("let objectKey = \"\";"), ingest.indexOf("const text = await readUpload"));
    expect(put).toMatch(/await env\.DOCUMENTS\.put\(key,[\s\S]*objectKey = key;/);
    // A key on the row for an object that is not there turns "we did not keep
    // it" into "it is missing".
    expect(put.indexOf("DOCUMENTS.put")).toBeLessThan(put.indexOf("objectKey = key"));
    expect(ingest).toContain("objectKey: input.objectKey ?? \"\"");
  });
});

describe("the field itself, rendered", () => {
  const drawn = (on: boolean) =>
    evaluateConsole().outsidePanel({
      on,
      id: "serp",
      placeholder: "SerpApi key",
      leaves: "Only the words you search for, from your Worker to SerpApi.",
      where: "Your key is on serpapi.com.",
    });

  it("offers to add a key when there is none, and to replace one when there is", () => {
    expect(drawn(false)).toContain("Add a key");
    expect(drawn(false)).not.toContain("This is on");
    expect(drawn(true)).toContain("Replace the key");
    expect(drawn(true)).toContain("This is on");
  });

  it("only offers to forget a key that exists", () => {
    // A "turn it off" link on a capability that is already off is a button
    // that does nothing, and the owner reads that as the thing being broken.
    expect(drawn(true)).toContain('id="del-serp"');
    expect(drawn(false)).not.toContain('id="del-serp"');
  });

  it("says what leaves, above the field rather than under it", () => {
    // The owner has to be able to decide before they paste, not discover it
    // underneath a key they have already given away.
    const html = drawn(false);
    expect(html).toContain("Only the words you search for, from your Worker to SerpApi.");
    expect(html).toContain("Nothing reaches us");
  });

  it("never renders a key into the page", () => {
    const html = drawn(true);
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/value=/);
  });
});

describe("what the console says before it asks for a key", () => {
  const panel = app.slice(app.indexOf("function outsidePanel"), app.indexOf("function paintVersion"));

  it("says what leaves the owner's account, in the panel that collects the key", () => {
    expect(panel).toContain("What leaves your account:");
    expect(app).toMatch(/Only the words you search for, from your Worker to SerpApi/);
    expect(app).toMatch(/The file itself, from your Worker to Nutrient/);
  });

  it("does not claim the search is used for customers", () => {
    // It is the owner's tool. An agent still answers a customer from the
    // owner's material or hands the conversation to a person.
    expect(app).toMatch(/Your customers' agents never use it/);
  });

  it("draws nothing on a deployment whose API does not have the routes", () => {
    // A button that 404s reads as a broken deployment rather than as a version
    // that has not arrived yet.
    expect(app).toMatch(/state\.apiRevision < NEEDS\.outside \? "" :/);
    expect(app).toMatch(/outside: 14,/);
  });

  it("never puts a key into the page it came from", () => {
    expect(panel).toContain('type="password"');
    expect(panel).not.toMatch(/value="\$\{/);
  });
});
