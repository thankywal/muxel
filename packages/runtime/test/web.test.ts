import { describe, expect, it } from "vitest";

import { normaliseSession, originAllowed, pseudoIdFor, type WebChannel } from "../src/web/channel.js";
import { widgetScript } from "../src/web/widget.js";

/**
 * The web channel is the only part of Muxel reachable without a secret. What
 * protects an operator's allowance is the origin check, and what keeps a
 * visitor's conversation theirs is the derived identifier, so both are pinned
 * here rather than trusted.
 */

function channel(patch: Partial<WebChannel> = {}): WebChannel {
  return {
    id: "chan1",
    businessId: "biz1",
    key: "abcdefgh12345678",
    botId: "bot1",
    title: "Shop",
    greeting: "",
    accent: "#2563eb",
    allowedOrigins: "",
    dailyLimit: 500,
    enabled: true,
    ...patch,
  };
}

describe("pseudoIdFor", () => {
  it("is always negative, where Telegram never goes", () => {
    // Conversations and customers are keyed by a Telegram account id. Reusing
    // those tables for web visitors is only safe while the two ranges cannot
    // meet.
    for (const session of ["abcdefgh", "a-very-long-session-id-0000", "zzzz9999"]) {
      expect(pseudoIdFor(session)).toBeLessThan(0);
    }
  });

  it("is stable, so a returning visitor is the same customer", () => {
    expect(pseudoIdFor("abcdefgh")).toBe(pseudoIdFor("abcdefgh"));
  });

  it("separates visitors", () => {
    expect(pseudoIdFor("abcdefgh")).not.toBe(pseudoIdFor("abcdefgi"));
  });

  it("stays inside the safe integer range", () => {
    expect(Number.isSafeInteger(pseudoIdFor("abcdefgh"))).toBe(true);
  });
});

describe("normaliseSession", () => {
  it("keeps a session the browser already holds", () => {
    expect(normaliseSession("abcdefgh1234")).toBe("abcdefgh1234");
  });

  it("mints one for anything it cannot trust", () => {
    // A visitor controls this value, so a crafted one must not become an id.
    for (const bad of [undefined, "", "short", "../../etc", "a".repeat(200), "has space"]) {
      const minted = normaliseSession(bad);
      expect(minted).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      expect(minted).not.toBe(bad);
    }
  });
});

describe("originAllowed", () => {
  it("accepts anyone while no site has been named", () => {
    expect(originAllowed(channel(), "https://anything.example")).toBe(true);
  });

  it("accepts the named site and its subdomains", () => {
    const c = channel({ allowedOrigins: "myshop.com" });
    expect(originAllowed(c, "https://myshop.com")).toBe(true);
    expect(originAllowed(c, "https://www.myshop.com")).toBe(true);
    expect(originAllowed(c, "http://shop.myshop.com:8080")).toBe(true);
  });

  it("refuses a site that merely ends with the same letters", () => {
    // notmyshop.com must not pass a check for myshop.com.
    expect(originAllowed(channel({ allowedOrigins: "myshop.com" }), "https://notmyshop.com")).toBe(
      false,
    );
  });

  it("refuses anything else once a site is named", () => {
    const c = channel({ allowedOrigins: "myshop.com, shop.example" });
    expect(originAllowed(c, "https://copycat.example")).toBe(false);
    expect(originAllowed(c, "not a url")).toBe(false);
  });

  it("accepts a request with no origin, which is the preview page", () => {
    expect(originAllowed(channel({ allowedOrigins: "myshop.com" }), null)).toBe(true);
  });

  it("tolerates a site written with its scheme, as an operator would type it", () => {
    expect(originAllowed(channel({ allowedOrigins: "https://myshop.com/" }), "https://myshop.com")).toBe(
      true,
    );
  });
});

describe("widgetScript", () => {
  const script = widgetScript({ origin: "https://muxel.example.workers.dev", channel: channel() });

  it("isolates itself from the host page", () => {
    // Without a shadow root the widget inherits whatever the site's CSS does
    // to a button, which is the difference between working everywhere and
    // working where it was tested.
    expect(script).toContain("attachShadow");
  });

  it("points at its own deployment", () => {
    expect(script).toContain("https://muxel.example.workers.dev/w/abcdefgh12345678");
  });

  it("picks readable text for a pale accent", () => {
    const pale = widgetScript({ origin: "https://x.dev", channel: channel({ accent: "#fde047" }) });
    expect(pale).toContain('"onAccent":"#111827"');
    expect(script).toContain('"onAccent":"#ffffff"');
  });

  it("falls back to the default when the accent is not a colour", () => {
    const odd = widgetScript({ origin: "https://x.dev", channel: channel({ accent: "red; }" }) });
    expect(odd).toContain("#2563eb");
    expect(odd).not.toContain("red; }");
  });

  it("escapes a greeting that would otherwise end the script tag", () => {
    const hostile = widgetScript({
      origin: "https://x.dev",
      channel: channel({ greeting: "</script><script>alert(1)</script>" }),
    });
    expect(hostile).not.toContain("</script>");
  });
});
