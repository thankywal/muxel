import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error plain JavaScript, deliberately not part of the TypeScript build
import { installConfig, stripJsonComments } from "../../../scripts/installConfig.mjs";

/**
 * scripts/install.mjs is the way out of a failed one click deploy. Cloudflare's
 * source importer can copy nothing but a parsed wrangler.jsonc into the
 * operator's repository, queue no build, and leave a placeholder Worker
 * answering "Hello world" behind a dashboard that reported success. No Muxel
 * code runs in that state, so nothing in the product can detect or repair it.
 *
 * The hand install is only a real answer to that if it deploys the same Worker
 * the button would have. These tests hold it to the shipped configuration, so
 * the recovery path cannot quietly drift into deploying something else.
 */

const shipped = await readFile(
  fileURLToPath(new URL("../../../wrangler.jsonc", import.meta.url)),
  "utf8",
);

function build() {
  return installConfig(shipped, {
    name: "muxel",
    main: "/abs/packages/runtime/src/index.ts",
    d1Id: "d1-id",
    kvId: "kv-id",
    d1Name: "muxel",
    kvName: "muxel",
    vectorizeName: "muxel-knowledge",
  });
}

describe("stripping comments from the shipped configuration", () => {
  it("leaves the shipped file as valid JSON", () => {
    expect(() => JSON.parse(stripJsonComments(shipped))).not.toThrow();
  });

  it("keeps comment markers that appear inside strings", () => {
    const parsed = JSON.parse(stripJsonComments('{"a": "https://x.dev/y", "b": "/* not */"}'));
    expect(parsed).toEqual({ a: "https://x.dev/y", b: "/* not */" });
  });

  it("removes both comment styles", () => {
    const parsed = JSON.parse(stripJsonComments('{ /* block */ "a": 1 // line\n, "b": 2 }'));
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("does not end a string at an escaped quote", () => {
    const parsed = JSON.parse(stripJsonComments('{"a": "say \\" // still text"}'));
    expect(parsed.a).toBe('say " // still text');
  });
});

describe("the configuration a hand install deploys", () => {
  it("binds everything the Worker expects", () => {
    const config = build();
    expect(config.d1_databases[0].binding).toBe("DB");
    expect(config.kv_namespaces[0].binding).toBe("STATE");
    expect(config.vectorize[0].binding).toBe("KNOWLEDGE");
    expect(config.ai.binding).toBe("AI");
  });

  it("carries the real identifiers rather than the shipped placeholders", () => {
    const config = build();
    expect(config.d1_databases[0].database_id).toBe("d1-id");
    expect(config.kv_namespaces[0].id).toBe("kv-id");
    expect(JSON.stringify(config)).not.toContain("00000000000000000000000000000000");
  });

  it("changes nothing else about the Worker", () => {
    // Everything here is a setting a past release got wrong somewhere and had
    // to fix. A hand install that quietly disagreed with the shipped file would
    // reintroduce any of them for exactly the people already stuck.
    const original = JSON.parse(stripJsonComments(shipped));
    const config = build();
    expect(config.compatibility_date).toBe(original.compatibility_date);
    expect(config.compatibility_flags).toEqual(original.compatibility_flags);
    expect(config.triggers).toEqual(original.triggers);
    expect(config.vars).toEqual(original.vars);
    expect(config.observability).toEqual(original.observability);
  });

  it("states neither workers_dev nor preview_urls", () => {
    // Not a style preference. Stating preview_urls stops Cloudflare's one click
    // form filling in the preview configuration it nonetheless validates, and
    // its own submit handler then throws on
    // previews_base_config.deploy_command being undefined. The submission
    // aborts half finished and the operator is left with a two file repository
    // and a placeholder Worker, while the dashboard reports success. Three
    // deploys were lost to it and every deploy without the setting worked.
    const original = JSON.parse(stripJsonComments(shipped));
    expect(original.workers_dev).toBeUndefined();
    expect(original.preview_urls).toBeUndefined();
  });

  it("drops the schema path, which does not resolve from a scratch directory", () => {
    expect(build().$schema).toBeUndefined();
  });

  it("makes the entry point absolute, because wrangler resolves it from the config", () => {
    expect(build().main.startsWith("/")).toBe(true);
  });
});
