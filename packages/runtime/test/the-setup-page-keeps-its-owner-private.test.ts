/**
 * The setup page named its owner.
 *
 * A deployment's own address answers with its setup page, to anyone who has
 * the address, which on a demo is everyone. Once a Telegram console bot was
 * connected, that page printed `Owner: Telegram id 1234567890`: the number of
 * a person's own Telegram account, on a public page, read back to nobody who
 * needed it. The person setting the deployment up typed it in; everybody else
 * has no business with it.
 *
 * The page still says whether there is an owner, because that is what someone
 * finishing setup needs to know. It no longer says who.
 */
import { describe, expect, it } from "vitest";

import { renderSetupPage } from "../src/setup.js";

const OWNER = 7_000_000_123;

const connected = {
  ok: true,
  schemaVersion: 20,
  botUsername: "my_console_bot",
  missing: [],
  note: "",
} as const;

describe("the public setup page", () => {
  it("says there is an owner without saying who", () => {
    const page = renderSetupPage({ ...connected, owner: OWNER });
    expect(page).not.toContain(String(OWNER));
    expect(page).toContain("<dt>Owner</dt><dd>set</dd>");
    // The bot is still named: a bot is public by design, and its name is how
    // the owner finds it.
    expect(page).toContain("@my_console_bot");
  });

  it("says plainly when there is none", () => {
    const page = renderSetupPage({ ...connected, owner: null });
    expect(page).toContain("<dt>Owner</dt><dd>not set</dd>");
    expect(page).not.toContain("null");
  });
});
