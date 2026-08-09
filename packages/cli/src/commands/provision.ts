/**
 * Resource provisioning.
 *
 * Each step is idempotent. Creating a resource that already exists is reported
 * as reused rather than as an error, so a run interrupted half way can simply
 * be repeated.
 */

import { MuxelError } from "@muxel/core";

import { progress } from "../output.js";
import { runWrangler } from "../wrangler.js";

/** Dimension count of the default embedding model. */
export const EMBEDDING_DIMENSIONS = 1024;

export interface ResourceIds {
  d1DatabaseId: string;
  kvNamespaceId: string;
  vectorizeIndex: string;
}

export interface ProvisionOptions {
  readonly cwd: string;
  readonly prefix: string;
}

function alreadyExists(output: string): boolean {
  return /already exists|duplicate|10053|already have/i.test(output);
}

/** Extracts the first 32 character hexadecimal identifier from wrangler output. */
function findId(output: string): string | null {
  return output.match(/\b[0-9a-f]{32}\b/)?.[0] ?? null;
}

async function createD1(options: ProvisionOptions): Promise<string> {
  const name = options.prefix;
  progress(`  d1 database ${name}`);
  const created = await runWrangler(["d1", "create", name], { cwd: options.cwd });
  const combined = `${created.stdout}${created.stderr}`;

  if (created.code === 0) {
    const id = findId(combined);
    if (id !== null) {
      return id;
    }
  }
  if (created.code !== 0 && !alreadyExists(combined)) {
    throw new MuxelError("upstream_failure", "could not create the D1 database", {
      stderr: created.stderr.trim().slice(0, 500),
    });
  }

  // The database exists. Read its identifier back from the list.
  const listed = await runWrangler(["d1", "list", "--json"], { cwd: options.cwd });
  if (listed.code === 0) {
    try {
      const rows = JSON.parse(listed.stdout) as { name?: string; uuid?: string }[];
      const match = rows.find((row) => row.name === name);
      if (match?.uuid !== undefined) {
        return match.uuid;
      }
    } catch {
      // Fall through to the error below.
    }
  }
  throw new MuxelError("upstream_failure", "could not determine the D1 database id", { name });
}

async function createKv(options: ProvisionOptions): Promise<string> {
  const title = `${options.prefix}-state`;
  progress(`  kv namespace ${title}`);
  const created = await runWrangler(["kv", "namespace", "create", "STATE"], {
    cwd: options.cwd,
  });
  const combined = `${created.stdout}${created.stderr}`;

  if (created.code === 0) {
    const id = findId(combined);
    if (id !== null) {
      return id;
    }
  }

  const listed = await runWrangler(["kv", "namespace", "list"], { cwd: options.cwd });
  if (listed.code === 0) {
    try {
      const rows = JSON.parse(listed.stdout) as { title?: string; id?: string }[];
      const match = rows.find((row) => row.title?.includes("STATE") === true);
      if (match?.id !== undefined) {
        return match.id;
      }
    } catch {
      // Fall through to the error below.
    }
  }
  throw new MuxelError("upstream_failure", "could not determine the KV namespace id", { title });
}

async function createVectorize(options: ProvisionOptions): Promise<string> {
  const name = `${options.prefix}-knowledge`;
  progress(`  vectorize index ${name}`);
  const created = await runWrangler(
    [
      "vectorize",
      "create",
      name,
      "--dimensions",
      String(EMBEDDING_DIMENSIONS),
      "--metric",
      "cosine",
    ],
    { cwd: options.cwd },
  );
  if (created.code !== 0 && !alreadyExists(`${created.stdout}${created.stderr}`)) {
    throw new MuxelError("upstream_failure", "could not create the Vectorize index", {
      stderr: created.stderr.trim().slice(0, 500),
    });
  }
  return name;
}

/** Creates every resource the Worker binds to and returns their identifiers. */
export async function provision(options: ProvisionOptions): Promise<ResourceIds> {
  progress("Provisioning resources in your Cloudflare account");
  return {
    d1DatabaseId: await createD1(options),
    kvNamespaceId: await createKv(options),
    vectorizeIndex: await createVectorize(options),
  };
}
