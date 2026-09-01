/**
 * Every place the console can send someone, it can draw.
 *
 * The rail is not the list of screens; it is the list of screens worth a
 * permanent seat. Inbox, Channels and Messages lost theirs — the waiting queue
 * is a tab on Customers, a channel is reached through the business it belongs
 * to, and a conversation is reached by opening a person's chat. Each of them is
 * still a screen, still linked to, and still has to render, so these hold that
 * a destination cannot quietly become unreachable or undrawable.
 *
 * The console is a classic script, so it is read and evaluated here rather than
 * imported: that way the assertions are about the values it actually builds and
 * not about the shape of its source text.
 */
import { describe, expect, it } from "vitest";
import { consoleSource as source, evaluateConsole } from "./console-harness.js";

const nav = evaluateConsole();
const ids = (items: { id: string }[]): string[] => items.map((item) => item.id);

describe("the rail", () => {
  it("is the four screens the owner works in", () => {
    // Not an arbitrary pin: the rail is what a person scans, and it grew to
    // seven by adding a seat for every screen that existed.
    expect(ids(nav.NAV)).toEqual(["overview", "agents", "businesses", "customers"]);
  });

  it("keeps the waiting badge on the screen that holds the queue", () => {
    // The count used to sit on Inbox. Inbox is now a tab on Customers, so a
    // badge left behind would be a number nobody could click through to.
    expect(source).toMatch(/item\.id === "customers" && state\.waiting > 0/);
    expect(source).toMatch(/nav-item\[data-view="customers"\]/);
  });
});

describe("nothing became unreachable", () => {
  it("still draws every screen it can be sent to", () => {
    for (const item of nav.ALL_VIEWS) {
      expect(nav.drawable, item.id).toContain(item.id);
      expect(nav.TITLES[item.id], item.id).toBeDefined();
    }
  });

  it("puts channels behind the owner's badge, where setup lives", () => {
    // A channel is a Telegram bot or a website widget: something added once.
    // It is not under Customers, so saying it was would have lost it.
    expect(ids(nav.OWNER_MENU)).toContain("channels");
  });

  it("reaches a conversation by opening a person's chat", () => {
    // Two callers: the customer drawer's button, and a row in the waiting
    // queue. Both name the customer, because a conversation with nobody in it
    // is not a screen anyone asked for.
    const callers = source.match(/go\("messages", \{ customerId/g) ?? [];
    expect(callers.length).toBeGreaterThanOrEqual(2);
  });

  it("draws the waiting queue from one table, wherever it is shown", () => {
    // The tab and the screen render the same rows. Two copies could come to
    // disagree about who is waiting, which is the one thing this list is for.
    expect(source).toMatch(/const waitingTable = \(waiting\) =>/);
    const uses = source.match(/waitingTable\(waiting\)/g) ?? [];
    expect(uses.length).toBe(2);
  });

  it("lets search find the screens that left the rail", () => {
    for (const id of ["messages", "inbox", "channels"]) {
      expect(ids(nav.ALL_VIEWS), id).toContain(id);
    }
  });
});
