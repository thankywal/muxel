/**
 * A customer's question appears once, however long the answer takes.
 *
 * Seen on the demo shop the night the film went in: a visitor typed one
 * question and saw it twice, one bubble under the other, and then one answer.
 * The widget draws what was typed straight away and asks the Worker for the
 * reply; while the model thinks, the six-second poll — there to collect what a
 * person on the shop's side may type — asked for everything after the last
 * row it knew, and the Worker, which had already stored the question, handed
 * it straight back. Two writers, one transcript.
 *
 * The rule now: a turn that is out is drawn by its own answer, and every row is
 * drawn once, by seq. These run the real widget script against a stub of the
 * little DOM it touches, with fetch under the test's control so the poll can
 * be made to land in the middle of a send.
 */
import { describe, expect, it } from "vitest";
import { widgetScript } from "../src/web/widget.js";

interface Stub {
  className: string;
  textContent: string;
  innerHTML: string;
  value: string;
  disabled: boolean;
  offsetHeight: number;
  offsetWidth: number;
  style: Record<string, string>;
  children: Stub[];
  parent: Stub | null;
  handlers: Record<string, (event: unknown) => void>;
  onclick: null | ((event: unknown) => void);
  onsubmit: null | ((event: unknown) => void);
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  appendChild(child: Stub): Stub;
  remove(): void;
  addEventListener(name: string, fn: (event: unknown) => void): void;
  setAttribute(): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture(): void;
  releasePointerCapture(): void;
  focus(): void;
  querySelector(selector: string): Stub | null;
}

function element(): Stub {
  const classes = new Set<string>();
  const el: Stub = {
    className: "", textContent: "", innerHTML: "", value: "", disabled: false,
    offsetHeight: 520, offsetWidth: 56, style: {}, children: [], parent: null, handlers: {},
    onclick: null, onsubmit: null,
    classList: {
      add: (c) => void classes.add(c),
      remove: (c) => void classes.delete(c),
      toggle: (c, on) => void ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    appendChild: (child) => { el.children.push(child); child.parent = el; return child; },
    remove: () => { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); },
    addEventListener: (name, fn) => { el.handlers[name] = fn; },
    setAttribute: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 56, height: 56 }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    focus: () => undefined,
    querySelector: () => null,
  };
  return el;
}

/** One pending fetch, answered by the test when it chooses. */
interface Pending {
  url: string;
  resolve(body: unknown, ok?: boolean): void;
  reject(): void;
}

function mountWidget() {
  const bubble = element();
  const teaser = element();
  const teaserSpan = element();
  const teaserButton = element();
  const panel = element();
  const list = element();
  const form = element();
  const input = element();
  const sendButton = element();
  const headerSpan = element();
  const headerButton = element();
  form.querySelector = (sel) => (sel === "input" ? input : sel === "button" ? sendButton : null);
  const root = element();
  root.querySelector = (sel) => {
    switch (sel) {
      case ".b": return bubble;
      case ".t": return teaser;
      case ".t span": return teaserSpan;
      case ".t button": return teaserButton;
      case ".p": return panel;
      case ".m": return list;
      case ".f": return form;
      case ".h span": return headerSpan;
      case ".h button": return headerButton;
      case ".d": return list.children.find((c) => c.className === "d") ?? null;
      default: return null;
    }
  };
  const host = element();
  (host as unknown as { attachShadow: () => Stub }).attachShadow = () => root;
  const body = element();
  let mounted = false;
  const document = { createElement: () => element(), body };
  const stored = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
  };
  const pending: Pending[] = [];
  const fetch = (url: string) =>
    new Promise((resolve, reject) => {
      pending.push({
        url,
        resolve: (payload, ok = true) => resolve({ ok, json: async () => payload }),
        reject: () => reject(new Error("network")),
      });
    });
  let tick: (() => void) | null = null;
  const setInterval = (fn: () => void) => { tick = fn; return 1; };
  const clearInterval = () => { tick = null; };
  const setTimeout = () => 0;
  const requestAnimationFrame = () => 0;
  const window = { innerWidth: 1280, innerHeight: 800, addEventListener: () => undefined } as Record<string, unknown>;

  const script = widgetScript({
    origin: "https://shop.example.workers.dev",
    channel: { key: "k1", title: "Shwe Coffee Shop", greeting: "", accent: "#2563eb", enabled: true } as never,
  });
  // The first createElement is the host; everything after is a bubble.
  document.createElement = () => { if (!mounted) { mounted = true; return host; } return element(); };
  new Function(
    "window", "document", "localStorage", "fetch", "setInterval", "clearInterval", "setTimeout", "requestAnimationFrame",
    script,
  )(window, document, localStorage, fetch, setInterval, clearInterval, setTimeout, requestAnimationFrame);

  const open = () => {
    bubble.handlers.pointerdown?.({ button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    bubble.handlers.pointerup?.({ pointerId: 1 });
  };
  const type = (text: string) => { input.value = text; form.onsubmit?.({ preventDefault: () => undefined }); };
  const bubbles = () => list.children.filter((c) => c.className.startsWith("r ")).map((c) => `${c.className.slice(2)}:${c.textContent}`);
  const take = (): Pending => {
    const next = pending.shift();
    if (next === undefined) throw new Error("no fetch was made");
    return next;
  };
  const flush = () => new Promise((r) => globalThis.setTimeout(r, 0));
  return { open, type, bubbles, take, pending, tick: () => tick?.(), flush };
}

const QUESTION = "ဘာတွေရောင်းလဲ";
const ANSWER = "ကျွန်တော်တို့ဆီမှာ Affogato - 8.00, Batch Brew - 4.00 ရှိပါတယ်။";

describe("a question typed while the shop is answering", () => {
  it("is drawn once when the poll lands in the middle of the send", async () => {
    const w = mountWidget();
    w.open();
    // A first exchange, so a session exists and the tick has something to poll.
    // The very first message cannot show this: there is no session to poll
    // for until the Worker has answered once.
    w.type("hello");
    w.take().resolve({ session: "s1", seq: 2, reply: "Hello — ask me anything about the shop." });
    await w.flush();
    // Ask, and let the send hang while the model thinks.
    w.type(QUESTION);
    const send = w.take();
    expect(send.url).toContain("/send");
    // The six-second tick fires in the middle. It used to ask the Worker for
    // every row after 2, get the question back, and draw it a second time.
    w.tick();
    if (w.pending.length > 0) {
      // Only the old widget gets here; what the Worker would say is the row it
      // already stored for this very question.
      w.take().resolve({ messages: [{ seq: 5, role: "user", text: QUESTION }] });
      await w.flush();
    }
    send.resolve({ session: "s1", seq: 6, reply: ANSWER });
    await w.flush();
    expect(w.bubbles()).toEqual([
      "u:hello",
      "a:Hello — ask me anything about the shop.",
      `u:${QUESTION}`,
      `a:${ANSWER}`,
    ]);
  });

  it("is drawn once when a poll asked before the send is answered during it", async () => {
    const w = mountWidget();
    w.open();
    w.type("hello");
    w.take().resolve({ session: "s1", seq: 2, reply: "Hello — ask me anything about the shop." });
    await w.flush();
    // Now a session exists, so the tick polls. The poll is out first…
    w.tick();
    const poll = w.take();
    expect(poll.url).toContain("/poll");
    expect(poll.url).toContain("after=2");
    // …then the question goes, and the poll comes back carrying the row the
    // Worker had stored for it in the meantime.
    w.type(QUESTION);
    const send = w.take();
    poll.resolve({ messages: [{ seq: 5, role: "user", text: QUESTION }] });
    await w.flush();
    send.resolve({ session: "s1", seq: 6, reply: ANSWER });
    await w.flush();
    expect(w.bubbles()).toEqual([
      "u:hello",
      "a:Hello — ask me anything about the shop.",
      `u:${QUESTION}`,
      `a:${ANSWER}`,
    ]);
  });
});

describe("a second Enter while the first is out", () => {
  it("sends nothing, and keeps what was typed for afterwards", async () => {
    // Seen live: two POST /send 73ms apart, two bubbles, two replies. The
    // button was disabled; the form was not, and Enter submits the form.
    const w = mountWidget();
    w.open();
    w.type(QUESTION);
    const send = w.take();
    w.type("ဈေးနှုန်း ဘယ်လောက်လဲ");
    expect(w.pending, "a second send went out while the first was in flight").toHaveLength(0);
    expect(w.bubbles()).toEqual([`u:${QUESTION}`]);
    send.resolve({ session: "s1", seq: 6, reply: ANSWER });
    await w.flush();
    // The reply has arrived; the next Enter is a new turn.
    w.type("ဈေးနှုန်း ဘယ်လောက်လဲ");
    expect(w.take().url).toContain("/send");
    expect(w.bubbles()).toEqual([`u:${QUESTION}`, `a:${ANSWER}`, "u:ဈေးနှုန်း ဘယ်လောက်လဲ"]);
  });
});

describe("what the poll is for still arrives", () => {
  it("draws a person's reply from the shop once, and not again on the next poll", async () => {
    const w = mountWidget();
    w.open();
    w.type("Is anyone there?");
    // A handover: the Worker stores the question and answers with no reply.
    w.take().resolve({ session: "s1", seq: 3, reply: "" });
    await w.flush();
    w.tick();
    w.take().resolve({ messages: [{ seq: 4, role: "assistant", text: "Hi, this is Mya from the shop." }] });
    await w.flush();
    // The same row again, from a poll that raced the previous one.
    w.tick();
    w.take().resolve({ messages: [{ seq: 4, role: "assistant", text: "Hi, this is Mya from the shop." }] });
    await w.flush();
    const drawn = w.bubbles().filter((b) => b.includes("Mya"));
    expect(drawn).toHaveLength(1);
  });

  it("asks from the reply's seq onwards once the send has answered", async () => {
    const w = mountWidget();
    w.open();
    w.type(QUESTION);
    w.take().resolve({ session: "s1", seq: 6, reply: ANSWER });
    await w.flush();
    w.tick();
    expect(w.take().url).toContain("after=6");
  });
});
