/**
 * Serves the built site, for local preview and for a host that is not Pages.
 *
 * This used to be the site: it read the console's files, rendered the guide
 * from the README on request, and picked between the product page and the
 * console by hostname. All of that now happens once, in
 * `scripts/build-site.mjs`, and what is left here is a file server pointed at
 * what that wrote. There is one implementation of the site again, so the copy
 * a browser gets from this process and the copy GitHub Pages serves cannot
 * disagree — they are the same bytes.
 *
 * Run `node scripts/build-site.mjs` first. SITE_BASE decides where the site
 * thinks it lives; this serves the root, so build with SITE_BASE=/.
 *
 * It keeps no database, no session and no record of which deployments exist,
 * and it is not in the path of anything an owner does: the console is a page
 * that talks to the owner's own Worker directly.
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE = process.env.SITE_DIR ?? path.join(DIR, "site");
const PORT = Number(process.env.PORT ?? 4400);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.get("/healthz", (_req, res) => {
  res.json({ service: "muxel-console" });
});

// The same shape Pages serves: /docs/ is the directory's index.html, and /docs
// redirects to it. Anything else is answered by the page the build wrote for
// exactly that, which is the product page.
app.use(express.static(SITE));
app.get(/.*/, (_req, res) => {
  res.status(404).sendFile(path.join(SITE, "404.html"));
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[muxel-console] serving ${SITE} on 127.0.0.1:${PORT}`);
});
