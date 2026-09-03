/**
 * Signing in to a deployment nobody made a Telegram bot for.
 *
 * The console had one way in: a pairing code, and only the Telegram console bot
 * can issue one. So an owner with a console key and no bot could reach their
 * deployment's address, be told it was a Muxel deployment, and then have
 * nothing to type — which is the whole product, unreachable, for anybody who
 * does not use Telegram.
 *
 * The field takes either secret now. What is held here is that the console asks
 * the deployment instead of reading the string: both doors are tried, in the
 * order that cannot spend a pairing code and then lose the answer, each is
 * handed the secret in the form it has always taken, and a deployment too old
 * to have the key door is not thereby shut out of the door it does have.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const read = (name: string): string =>
  readFileSync(new URL(`../../console/public/${name}`, import.meta.url), "utf8");
const source = read("app.js");
const page = read("console.html");

const WORKER = "https://muxel.example.workers.dev";

/** What one press of Open console did, seen from outside the console. */
interface Attempt {
  /** Every call it made to the deployment, in the order it made them. */
  calls: { path: string; body: Record<string, unknown> }[];
  token: string | null;
  error: string;
  errorShown: boolean;
  /** Whether the console itself is now on screen and onboarding is not. */
  inside: boolean;
}

/** The deployment's answer to one call, or the browser refusing to make it. */
type Answer = Response | Error;

const opened = (token: string): Answer =>
  new Response(JSON.stringify({ ok: true, token }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const refused = (error: string, message: string): Answer =>
  new Response(JSON.stringify({ error, message }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });

const noop = (): unknown => undefined;

/** One element, remembering the few things a sign in actually does to one. */
function element(id: string): Record<string, unknown> {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const classes = new Set<string>();
  const base: Record<string, unknown> = {
    id,
    handlers,
    classes,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    classList: {
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
      toggle: noop,
      contains: (name: string) => classes.has(name),
    },
    addEventListener: (type: string, fn: (event: unknown) => unknown) => void handlers.set(type, fn),
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: () => null,
    dataset: {},
    style: {},
  };
  return new Proxy(base, {
    get: (target, key) => (key in target ? Reflect.get(target, key) : noop),
    set: (target, key, value) => {
      target[String(key)] = value;
      return true;
    },
  }) as Record<string, unknown>;
}

/**
 * Runs the console for real, and presses Open console once.
 *
 * The console is a classic script a browser fetches rather than a module, so
 * the only way to have its behaviour is to execute it; reading its source with
 * a regex would assert the shape of the text instead. `answers` is what the
 * deployment says, one entry per call in the order the console makes them, and
 * an Error is the browser refusing a call it could not make at all.
 */
async function signIn(secret: string, answers: Answer[]): Promise<Attempt> {
  const calls: Attempt["calls"] = [];
  const store = new Map<string, string>([["muxel.worker", WORKER]]);
  const elements = new Map<string, Record<string, unknown>>();
  const byId = (id: string): Record<string, unknown> => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id) as Record<string, unknown>;
  };
  const pending = [...answers];

  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: byId,
      querySelector: () => byId("selected"),
      querySelectorAll: () => [],
      createElement: () => byId("created"),
      addEventListener: noop,
      body: byId("body"),
      documentElement: byId("documentElement"),
    },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    window: { matchMedia: () => ({ matches: false }), addEventListener: noop },
    navigator: { clipboard: { writeText: async () => undefined } },
    fetch: async (url: string, init: { body?: string }) => {
      calls.push({
        path: String(url).slice(WORKER.length),
        body: JSON.parse(init?.body ?? "{}") as Record<string, unknown>,
      });
      const answer = pending.shift();
      if (answer === undefined) throw new Error(`nothing scripted an answer for ${url}`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: noop,
    console,
    Response,
    AbortSignal,
    URL,
  };

  const context = createContext(sandbox);
  runInContext(source, context);
  // Drawing the console is a different subject with a network of its own, and
  // this is about the door. Both are function declarations, so the console's
  // own call to them lands on these.
  sandbox.shell = noop;
  sandbox.render = async (): Promise<void> => undefined;

  byId("pairCode").value = secret;
  const submit = (byId("pairForm").handlers as Map<string, (event: unknown) => unknown>).get("submit");
  expect(submit, "the sign in form is not wired up").toBeTypeOf("function");
  await submit?.({ preventDefault: noop });

  return {
    calls,
    token: store.get("muxel.token") ?? null,
    error: String(byId("connectErr").textContent ?? ""),
    errorShown: (byId("connectErr").classes as Set<string>).has("on"),
    inside: byId("onboardingWrap").hidden === true && byId("shell").hidden === false,
  };
}

const BAD_KEY = (): Answer => refused("bad_key", "That key is not this deployment's console key.");
const BAD_CODE = (): Answer => refused("bad_code", "That code is not valid any more.");

describe("one field, two doors", () => {
  it("asks the key door first and the pairing door second", async () => {
    // Pairing spends the code whether or not its answer arrives, so it is asked
    // last: nothing follows it that could throw away the token it just issued.
    const attempt = await signIn("open-this-console-of-mine", [BAD_KEY(), BAD_CODE()]);
    expect(attempt.calls.map((call) => call.path)).toEqual(["/admin/claim", "/admin/pair"]);
  });

  it("hands each door the secret in the form that door takes", async () => {
    // The key is compared character for character against what the owner set in
    // the Worker, so case folding it would refuse a correct key. The code is
    // upper cased, which is what this field has always done and what the
    // pairing door has always been handed.
    const attempt = await signIn("  Correct-Horse-Battery  ", [BAD_KEY(), BAD_CODE()]);
    expect(attempt.calls[0]?.body).toEqual({ key: "Correct-Horse-Battery" });
    expect(attempt.calls[1]?.body).toEqual({ code: "CORRECT-HORSE-BATTERY" });
  });

  it("does not read the secret to decide which door it belongs to", async () => {
    // A string that looks exactly like a pairing code is still offered to the
    // key door, because the shape of a secret is not a fact about it.
    const attempt = await signIn("ABCD2345", [opened("token-for-a-key-that-looks-like-a-code")]);
    expect(attempt.calls.map((call) => call.path)).toEqual(["/admin/claim"]);
    expect(attempt.token).toBe("token-for-a-key-that-looks-like-a-code");
  });
});

describe("a deployment with no Telegram bot at all", () => {
  it("opens on the console key alone, with no code asked for", async () => {
    const attempt = await signIn("a-key-of-sixteen-plus", [opened("token-from-the-key-door")]);
    expect(attempt.calls.map((call) => call.path)).toEqual(["/admin/claim"]);
    expect(attempt.token).toBe("token-from-the-key-door");
    expect(attempt.inside).toBe(true);
    expect(attempt.errorShown).toBe(false);
  });
});

describe("a deployment older than the key door", () => {
  it("still pairs when the call is refused before it is made", async () => {
    // A Worker that predates /admin/claim answers it in plain text with none of
    // the cross origin headers, so the browser refuses the fetch and there is no
    // status to read. A console is routinely newer than the deployment it talks
    // to, and that must not cost the owner the door their deployment has.
    const attempt = await signIn("ABCD2345", [new TypeError("Failed to fetch"), opened("paired")]);
    expect(attempt.calls.map((call) => call.path)).toEqual(["/admin/claim", "/admin/pair"]);
    expect(attempt.token).toBe("paired");
    expect(attempt.inside).toBe(true);
  });

  it("still pairs when the call is answered as not found", async () => {
    const attempt = await signIn("ABCD2345", [new Response("not found", { status: 404 }), opened("paired")]);
    expect(attempt.calls.map((call) => call.path)).toEqual(["/admin/claim", "/admin/pair"]);
    expect(attempt.token).toBe("paired");
    expect(attempt.inside).toBe(true);
  });
});

describe("when neither door opens", () => {
  it("names both ways in, and repeats neither door's own answer", async () => {
    // "That code is not valid any more" is the wrong sentence to show somebody
    // who typed their key, and no single door knows which of the two the owner
    // was reaching for.
    const attempt = await signIn("not-the-secret", [BAD_KEY(), BAD_CODE()]);
    expect(attempt.token).toBeNull();
    expect(attempt.inside).toBe(false);
    expect(attempt.errorShown).toBe(true);
    // And it says where the key actually is, which is the deployment's own
    // page. Naming the setting instead sent people to a box in a dashboard to
    // read a secret that is not stored there.
    expect(attempt.error).toContain("Worker's own page");
    expect(attempt.error).toContain("console bot");
    expect(attempt.error).not.toContain("That code is not valid any more.");
    expect(attempt.error).not.toContain("That key is not this deployment's console key.");
  });
});

describe("the screen somebody with no Telegram reads", () => {
  it("names the key on the field that takes it, and the bot as the other way", () => {
    const panel = page.slice(page.indexOf('class="panel pad connect"'), page.indexOf('id="connectErr"'));
    expect(panel).toMatch(/printed on your deployment's own page/);
    // Telegram, conditionally. It was the only instruction on this screen.
    expect(panel).toMatch(/if you set up a\s+console bot/);
    expect(panel).not.toContain("Open your console bot in Telegram, tap");
  });

  it("puts every Telegram step after the console is already open", () => {
    const steps = page.slice(page.indexOf('<ol class="steps">'), page.indexOf("</ol>"));
    const items = steps.match(/<li>[\s\S]*?<\/li>/g) ?? [];
    expect(items.length).toBe(6);
    const telegram = items.filter((item) => /Telegram|BotFather|ADMIN_BOT_TOKEN/.test(item));
    expect(telegram).toHaveLength(1);
    expect(items.indexOf(telegram[0] as string)).toBe(items.length - 1);
    // And nothing before the deploy asks the reader to invent anything. The
    // deploy form makes every secret it is told about a required field, so a
    // step here that names one is a wall in front of somebody who has nothing
    // to put in it.
    const deploy = items.findIndex((item) => item.includes("Create and deploy"));
    expect(deploy).toBeGreaterThanOrEqual(0);
    for (const item of items.slice(0, deploy + 1)) {
      expect(item, `a step before deploying names a setting: ${item}`).not.toMatch(
        /<code>[A-Z][A-Z0-9_]{3,}<\/code>/,
      );
    }
  });
});
