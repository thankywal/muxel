/**
 * What an update is not allowed to take.
 *
 * The one click deploy writes real values into a deployment's wrangler.jsonc:
 * the Worker's name, the id of the D1 database holding every conversation, the
 * id of the KV namespace holding its master key. Upstream carries placeholders
 * there. The update copied upstream's tree wholesale, so the button that
 * updates a deployment would have renamed it and pointed it at a database that
 * does not exist, with the conversations still sitting in the old one.
 *
 * Caught by reading a real deployment's config against upstream's before
 * pressing the button, which is the only place the two were ever compared.
 */
import { describe, expect, it } from "vitest";
import { belongsToDeployment, configDrift, OWNED_BY_DEPLOYMENT } from "../src/web/deployment-files.js";

const UPSTREAM = `{
  // Comments are legal here and must not confuse the comparison.
  "name": "muxel",
  "compatibility_date": "2026-08-01",
  "d1_databases": [{ "binding": "DB", "database_name": "muxel", "database_id": "00000000000000000000000000000000" }],
  "kv_namespaces": [{ "binding": "STATE", "id": "00000000000000000000000000000000" }]
}`;

/** Exactly the shape the deploy button leaves behind. */
const DEPLOYED = `{
  "name": "muxel-demo",
  "compatibility_date": "2026-08-01",
  "d1_databases": [{ "binding": "DB", "database_name": "muxel", "database_id": "658bc545-8973-413b-9564-52d7c0633ab4" }],
  "kv_namespaces": [{ "binding": "STATE", "id": "3686d07d06e9472ca36a1a4e73162aeb" }]
}`;

describe("what an update leaves alone", () => {
  it("keeps the file that names the owner's Worker and database", () => {
    expect(belongsToDeployment("wrangler.jsonc")).toBe(true);
  });

  it("keeps the owner's workflow directory", () => {
    expect(belongsToDeployment(".github/workflows/update.yml")).toBe(true);
  });

  it("takes everything else from upstream", () => {
    for (const path of [
      "packages/runtime/src/index.ts",
      "package.json",
      "README.md",
      "wrangler.jsonc.example",
      "docs/.github-notes.md",
    ]) {
      expect(belongsToDeployment(path), path).toBe(false);
    }
  });

  it("lists each owned path once, so the two filters cannot disagree", () => {
    expect(new Set(OWNED_BY_DEPLOYMENT).size).toBe(OWNED_BY_DEPLOYMENT.length);
  });
});

describe("telling the owner when their config is behind", () => {
  it("stays quiet when only the owner's own identifiers differ", () => {
    // This is the normal state of every deployment forever. A warning here
    // would appear on every update and mean nothing.
    expect(configDrift(UPSTREAM, DEPLOYED)).toBe(false);
  });

  it("speaks up when upstream changed something the owner has to copy", () => {
    const moved = UPSTREAM.replace('"2026-08-01"', '"2026-12-01"');
    expect(configDrift(moved, DEPLOYED)).toBe(true);
  });

  it("notices a binding upstream added", () => {
    const added = UPSTREAM.replace(
      '"kv_namespaces"',
      '"vectorize": [{ "binding": "KNOWLEDGE", "index_name": "muxel-knowledge" }],\n  "kv_namespaces"',
    );
    expect(configDrift(added, DEPLOYED)).toBe(true);
  });

  it("reads a trailing comma, which wrangler allows and JSON does not", () => {
    expect(configDrift(UPSTREAM, DEPLOYED.replace("}]\n}", "}],\n}"))).toBe(false);
  });

  it("does not cry drift over a file it could not parse", () => {
    expect(configDrift(UPSTREAM, "{ this is not json")).toBe(false);
  });
});
