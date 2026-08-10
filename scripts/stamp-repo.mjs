#!/usr/bin/env node
/**
 * Records which repository this build came from.
 *
 * Workers Builds exposes the branch and the commit but not the repository, so
 * it is read from the checkout itself. The result lets the setup page link at
 * the exact GitHub setting an operator needs, instead of describing where to
 * find it.
 *
 * Best effort by design. A build with no git, no origin or an unrecognised
 * remote leaves the committed default in place and says so. Failing a
 * deployment over a cosmetic link would be a poor trade.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TARGET = fileURLToPath(new URL("../packages/runtime/src/repo.ts", import.meta.url));

/** Extracts `owner/name` from either remote form GitHub hands out. */
function parseSlug(remote) {
  const match = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote.trim());
  return match === null ? null : `${match[1]}/${match[2]}`;
}

function currentRemote() {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

const remote = currentRemote();
const slug = remote === null ? null : parseSlug(remote);

if (slug === null) {
  console.log("stamp-repo: no GitHub origin found, leaving the repository unknown");
  process.exit(0);
}

const source = readFileSync(TARGET, "utf8");
const stamped = source.replace(
  /export const SOURCE_REPO = "[^"]*";/,
  `export const SOURCE_REPO = ${JSON.stringify(slug)};`,
);

if (stamped === source) {
  console.log(`stamp-repo: already set to ${slug}`);
  process.exit(0);
}

writeFileSync(TARGET, stamped);
console.log(`stamp-repo: built from ${slug}`);
