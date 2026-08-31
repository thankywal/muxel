/**
 * The files an update must not overwrite.
 *
 * The one click deploy fills a deployment's `wrangler.jsonc` with real values:
 * the Worker's name, the id of the D1 database holding every conversation, the
 * id of the KV namespace holding its master key. Upstream's copy carries
 * placeholders in those slots, because upstream has no account and no database.
 *
 * The update copied upstream's tree wholesale, which meant the button that
 * updates a deployment would also rename it and point it at a database that
 * does not exist. The conversations would still be in D1 and nothing would be
 * able to read them.
 *
 * So this is the one record of what belongs to a deployment rather than to
 * upstream. `.github/` was already on that list for a different reason and is
 * here now for the same one: it is the owner's, not ours. Every consumer reads
 * this rather than deciding for itself.
 */

/** Paths kept from the deployment's own repository, never taken from upstream. */
export const OWNED_BY_DEPLOYMENT = [
  // A token without the workflows permission cannot write these, and whatever
  // the owner keeps there is theirs either way.
  ".github/",
  // Names the Worker and every resource in the owner's account.
  "wrangler.jsonc",
] as const;

export function belongsToDeployment(path: string): boolean {
  return OWNED_BY_DEPLOYMENT.some((owned) =>
    owned.endsWith("/") ? path.startsWith(owned) : path === owned,
  );
}

/**
 * The fields inside `wrangler.jsonc` that name something in the owner's own
 * account, and so differ legitimately from upstream forever.
 */
const IDENTITY_KEYS = new Set(["name", "account_id", "database_id", "id", "index_name", "bucket_name"]);

/** JSONC is JSON with comments. Only the parse needs them gone. */
function stripComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  // Trailing commas are legal in wrangler's dialect and not in JSON.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** Everything but the owner's own identifiers, so two configs can be compared. */
function withoutIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIdentity);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (IDENTITY_KEYS.has(key)) continue;
      out[key] = withoutIdentity(inner);
    }
    return out;
  }
  return value;
}

/**
 * Reports whether upstream's configuration has changed in a way this
 * deployment's own copy does not have yet.
 *
 * Keeping the owner's file is right and also means a new binding upstream adds
 * never arrives. Saying so is the difference between a limitation and a trap:
 * the owner is told what to add, in the one place they would look.
 */
export function configDrift(upstreamText: string, ownText: string): boolean {
  try {
    const upstream = withoutIdentity(JSON.parse(stripComments(upstreamText)));
    const own = withoutIdentity(JSON.parse(stripComments(ownText)));
    return JSON.stringify(upstream) !== JSON.stringify(own);
  } catch {
    // A file that will not parse is not evidence of drift. Claiming it is would
    // put a warning on every update that nobody could act on.
    return false;
  }
}
