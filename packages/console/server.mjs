/**
 * Muxel landing page and web console.
 *
 * Deliberately isolated: its own directory outside /opt/oro-agent, its own
 * pm2 process, its own port and its own nginx block, so that day to day work
 * on the agent cannot take the demo down and vice versa.
 *
 * The console is a RENDERER, not a reimplementation. Every screen and every
 * button already exists in the Muxel Worker as `screenFor(action, args) ->
 * { text, rows: ButtonSpec[][] }`, so one proxied call brings all of them.
 *
 * It is also BYOC all the way down: the deployment being managed is named by
 * the browser, not by this server, and nothing about it is stored here. This
 * server keeps no database and no session.
 */
import express from "express";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4400);

/** Optional default, so the demo deployment can be preconfigured. */
const DEFAULT_WORKER = (process.env.MUXEL_WORKER_URL ?? "").replace(/\/$/, "");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

/**
 * The browser hands us a URL and we make a request to it, so this is the one
 * place an open proxy could be created. Only public https hosts are allowed,
 * and the address is resolved and checked before use so that a name pointing
 * at a private range cannot reach anything on this box or its network.
 */
async function assertSafeWorkerUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That does not look like a URL.");
  }
  if (url.protocol !== "https:") throw new Error("The deployment URL must be https.");
  if (url.port && url.port !== "443") throw new Error("Use the default https port.");

  const { address } = await dns.lookup(url.hostname);
  const v4 = net.isIPv4(address);
  const bad =
    address === "127.0.0.1" ||
    address === "::1" ||
    (v4 &&
      (address.startsWith("10.") ||
        address.startsWith("192.168.") ||
        address.startsWith("169.254.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
        address.startsWith("100.64.")));
  if (bad) throw new Error("That address is not reachable from the public internet.");
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

app.get("/healthz", (_req, res) => {
  res.json({ service: "muxel-console", defaultWorker: DEFAULT_WORKER || null });
});

/** Checks a deployment before the console commits to it. */
app.post("/api/connect", async (req, res) => {
  try {
    const base = await assertSafeWorkerUrl(String(req.body?.worker ?? ""));
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(12_000) });
    const body = await r.json().catch(() => ({}));
    if (body?.service !== "muxel") {
      return res.status(400).json({
        error: "not_muxel",
        message: "That URL answered, but it is not a Muxel deployment.",
      });
    }
    res.json({ ok: true, base, status: body.status ?? "unknown", missing: body.missing ?? [] });
  } catch (error) {
    res.status(400).json({
      error: "unreachable",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/** Trades the code the console bot showed for a token from that deployment. */
app.post("/api/pair", async (req, res) => {
  try {
    const base = await assertSafeWorkerUrl(String(req.body?.worker ?? ""));
    const r = await fetch(`${base}/admin/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: String(req.body?.code ?? "") }),
      signal: AbortSignal.timeout(15_000),
    });
    res.status(r.status).type("application/json").send(await r.text());
  } catch (error) {
    res.status(400).json({
      error: "unreachable",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/** The single door onto the console. */
app.post("/api/screen", async (req, res) => {
  const target = String(req.body?.worker ?? DEFAULT_WORKER ?? "");
  if (!target) {
    return res.status(503).json({
      error: "not_connected",
      message: "This console is not pointed at a deployment yet.",
    });
  }
  try {
    const base = await assertSafeWorkerUrl(target);
    const upstream = await fetch(`${base}/admin/screen`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(req.get("authorization") ? { authorization: req.get("authorization") } : {}),
      },
      body: JSON.stringify({
        action: req.body?.action,
        args: req.body?.args ?? [],
        ...(req.body?.answer ? { answer: req.body.answer } : {}),
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const body = await upstream.text();
    res
      .status(upstream.status)
      .type(upstream.headers.get("content-type") ?? "application/json")
      .send(body);
  } catch (error) {
    res.status(502).json({
      error: "upstream_unreachable",
      message: error instanceof Error ? error.message : String(error),
    });
  }
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
  console.log(`[muxel-console] 127.0.0.1:${PORT}  default worker=${DEFAULT_WORKER || "(none)"}`);
});
