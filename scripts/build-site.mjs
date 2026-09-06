#!/usr/bin/env node
/**
 * Builds the whole site as files, so a static host can serve it.
 *
 * There used to be a small express process on a VPS: it served the console's
 * files, rendered the guide from the README, and picked between the product
 * page and the console by hostname. Only the first of those needs a process at
 * all, and the machine it ran on was the last thing in Muxel's own path that
 * an owner had to trust. This writes the same site out as files instead, and
 * GitHub Pages serves them.
 *
 * The two faces the hostname used to choose between become two paths: the
 * product page at the root, the console under /console/. Nothing in the console
 * reads the URL — it has no router, no history and no hash — so a path is free.
 *
 * The base path is the one thing that changes between hosts: a project site
 * lives under /<repo>/, a custom domain lives at /. It is read from the
 * environment rather than decided here, because the workflow gets it from
 * GitHub itself, and every root-absolute URL in the site is rewritten through
 * it on the way out. What may be rewritten is the set of names this build
 * actually emits, so a link to something that does not exist cannot be quietly
 * repointed, and a new one that nobody taught this about fails the check below.
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fileFor, LANGS, PAGES, renderGuide } from "../packages/console/guide.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONSOLE = path.join(ROOT, "packages/console");

/** Trailing slash always, leading slash always: "/muxel" and "muxel/" both mean "/muxel/". */
export function normalizeBase(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "" || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

/**
 * Where a URL can begin: inside a quote, or inside a stylesheet's url().
 *
 * A bare open bracket was here once and it ate `text.replace(/docs/g, x)`,
 * because a regular expression in JavaScript starts exactly the way a path
 * does. Naming url() rather than the bracket keeps the stylesheets and leaves
 * the code alone.
 */
const URL_START = /(["'`]|url\()\/([A-Za-z0-9._-]+)/g;

/**
 * Rewrites the site's own root-absolute URLs onto the base path.
 *
 * `roots` is the first path segment of everything this build emits. Anything
 * else beginning with a slash is somebody else's URL and is left alone.
 */
export function withBase(text, base, roots) {
  return text.replace(URL_START, (whole, open, first) =>
    roots.has(first) ? `${open}${base}${first}` : whole,
  );
}

/** Every root-absolute reference to one of the site's own names, unrewritten. */
export function missedRoots(text, roots) {
  const missed = new Set();
  for (const [, , first] of text.matchAll(URL_START)) {
    if (roots.has(first)) missed.add(first);
  }
  return [...missed];
}

const REWRITTEN = new Set([".html", ".css", ".js", ".json"]);

/**
 * Writes the site. Returns what it wrote, so a test can read the site rather
 * than read this file and take its word for it.
 */
export async function buildSite({ base = "/muxel/", out = path.join(ROOT, "site") } = {}) {
  base = normalizeBase(base);
  const OUT = out;

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // The console's own files, flat at the root, exactly as they were served.
  const publicDir = path.join(CONSOLE, "public");
  for (const name of await readdir(publicDir)) {
    if (name === "index.html" || name === "console.html") continue;
    await cp(path.join(publicDir, name), path.join(OUT, name), { recursive: true });
  }
  // The README's pictures, where the rendered README looks for them.
  await cp(path.join(ROOT, "docs/media"), path.join(OUT, "docs/media"), { recursive: true });

  /** The pages this build writes, as path → HTML. */
  const pages = new Map();
  pages.set("index.html", await readFile(path.join(publicDir, "index.html"), "utf8"));
  pages.set("console/index.html", await readFile(path.join(publicDir, "console.html"), "utf8"));
  for (const key of [...Object.keys(LANGS), ...Object.keys(PAGES)]) {
    const file = fileFor(key);
    const from = file.startsWith("README") ? file : path.join("docs", file);
    const markdown = await readFile(path.join(ROOT, from), "utf8");
    const where = key === "en" ? "docs/index.html" : `docs/${key}/index.html`;
    pages.set(where, renderGuide({ markdown, key }).html);
  }
  // A static host answers an unknown path with this. The product page is the
  // honest answer: it says what this is and links to everything else.
  pages.set("404.html", pages.get("index.html"));

  // What may be rewritten: the first path segment of everything emitted.
  const roots = new Set([
    ...(await readdir(OUT)),
    ...[...pages.keys()].map((p) => p.split("/")[0]),
  ]);

  for (const [where, html] of pages) {
    const file = path.join(OUT, where);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, withBase(html, base, roots));
  }

  // The files copied above carry the same URLs, so they go through the same rewrite.
  const rewritten = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (REWRITTEN.has(path.extname(entry.name)) && !pages.has(path.relative(OUT, full))) {
        const text = await readFile(full, "utf8");
        await writeFile(full, withBase(text, base, roots));
        rewritten.push(path.relative(OUT, full));
      }
    }
  };
  await walk(OUT);

  // Jekyll is not building this, and it would drop anything beginning with _.
  await writeFile(path.join(OUT, ".nojekyll"), "");

  // Nothing may still point at the root when the site does not live there.
  if (base !== "/") {
    for (const [where] of pages) {
      const missed = missedRoots(await readFile(path.join(OUT, where), "utf8"), roots);
      if (missed.length > 0) throw new Error(`${where} still points at ${missed.join(", ")}`);
    }
    for (const where of rewritten) {
      const missed = missedRoots(await readFile(path.join(OUT, where), "utf8"), roots);
      if (missed.length > 0) throw new Error(`${where} still points at ${missed.join(", ")}`);
    }
  }

  return { base, out: OUT, pages: [...pages.keys()], rewritten };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const built = await buildSite({ base: process.env.SITE_BASE ?? "/muxel/" });
  console.log(`site: ${built.pages.length} pages and ${built.rewritten.length} files under ${built.base}`);
}
