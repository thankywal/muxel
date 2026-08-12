/**
 * Turns the shipped wrangler.jsonc into the configuration a direct install
 * deploys.
 *
 * A hand install exists because Cloudflare's source importer can fail silently
 * and leave an operator with no working deployment and no way to make one. It
 * is only worth having if what it deploys is the same Worker the deploy button
 * deploys. If the two configurations drift, the recovery path becomes its own
 * source of bugs, reachable only by people who are already having a bad day.
 *
 * So the shipped file stays the single description of the Worker, and this
 * replaces nothing in it but the three placeholder identifiers, which cannot be
 * known until the resources exist.
 */

/** Removes JSONC comments without touching anything inside a string. */
export function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (character === "\n") {
        inLine = false;
        out += character;
      }
      continue;
    }

    if (inBlock) {
      if (character === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      out += character;
      if (character === "\\") {
        out += next ?? "";
        i += 1;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      out += character;
      continue;
    }

    if (character === "/" && next === "/") {
      inLine = true;
      i += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }

    out += character;
  }

  return out;
}

/**
 * Builds the deployable configuration from the shipped one.
 *
 * `main` is made absolute because wrangler resolves the entry point relative to
 * the configuration file, and this one is written to a scratch directory.
 */
export function installConfig(shipped, { name, main, d1Id, kvId, d1Name, kvName, vectorizeName }) {
  const config = JSON.parse(stripJsonComments(shipped));

  // The schema path is relative to the repository root and would dangle from
  // the scratch directory. Nothing at deploy time reads it.
  delete config.$schema;

  config.name = name;
  config.main = main;
  config.d1_databases = [{ binding: "DB", database_name: d1Name, database_id: d1Id }];
  config.kv_namespaces = [{ binding: "STATE", id: kvId }];
  config.vectorize = [{ binding: "KNOWLEDGE", index_name: vectorizeName }];

  return config;
}
