/**
 * Muxel landing page and web console.
 *
 * Deliberately isolated: its own directory outside /opt/oro-agent, its own
 * pm2 process, its own port and its own nginx block, so that day to day work
 * on the agent cannot take the demo down and vice versa.
 *
 * This process serves files. That is the whole of it.
 *
 * It used to proxy the console's calls through to the owner's Worker, which
 * put it in the path of every message, every uploaded file and every bearer
 * token, and made the promise on the front page false: there WAS a server of
 * ours in the path. The Worker already answers the browser directly, so the
 * proxy was removed rather than defended. Switching this process off now stops
 * new people from loading the page and does not interrupt a single deployment.
 *
 * It keeps no database, no session and no record of which deployments exist.
 */
import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fileFor, renderGuide } from "./guide.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4400);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.get("/healthz", (_req, res) => {
  res.json({ service: "muxel-console" });
});

// No directory redirects: public/docs/ holds the guide's images, and without
// this express answered /docs itself with a 301 to /docs/ before the guide
// route below ever saw it.
app.use(express.static(path.join(DIR, "public"), { index: false, redirect: false }));

/**
 * The guide, which is the README rendered.
 *
 * Read once per process from the copy deploy.sh puts beside this file. The
 * copy changes only when a deploy replaces it, and a deploy restarts this
 * process, so there is nothing to invalidate.
 */
const GUIDE_DIR = path.join(DIR, "guide");
const guides = new Map();
async function guide(key) {
  const file = fileFor(key);
  if (file === null) return null;
  if (!guides.has(key)) {
    const markdown = await readFile(path.join(GUIDE_DIR, file), "utf8");
    guides.set(key, renderGuide({ markdown, key }).html);
  }
  return guides.get(key);
}
app.get(["/docs", "/docs/:key"], async (req, res, next) => {
  try {
    const html = await guide(req.params.key ?? "en");
    if (html === null) return next();
    res.type("html").send(html);
  } catch (error) {
    next(error);
  }
});

/**
 * One deployment, two faces, chosen by hostname so each owns a clean root:
 * muxel.site is the product page a stranger lands on, app.muxel.site is where
 * an owner learns, deploys and then works.
 */
const CONSOLE_HOSTS = new Set(["app.muxel.site"]);
app.get(/.*/, (req, res) => {
  const host = (req.hostname || "").toLowerCase();
  const wantsConsole = CONSOLE_HOSTS.has(host) || req.path.startsWith("/console");
  res.sendFile(path.join(DIR, "public", wantsConsole ? "console.html" : "index.html"));
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[muxel-console] serving files on 127.0.0.1:${PORT}`);
});
