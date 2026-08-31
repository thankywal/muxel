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
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4400);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.get("/healthz", (_req, res) => {
  res.json({ service: "muxel-console" });
});

app.use(express.static(path.join(DIR, "public"), { index: false }));

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
