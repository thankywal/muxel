/**
 * The chat bubble a shop pastes into its own website.
 *
 * Served as one plain script with no dependencies and no build step, because
 * the person installing it is pasting a line into a site they may not fully
 * control. It must not fight a stylesheet, must not need a framework, and must
 * work when dropped anywhere in the page.
 *
 * Everything is inside a shadow root so the host page's CSS cannot reach in
 * and the widget's CSS cannot leak out. That is the difference between a
 * widget that works on any site and one that works on the sites we tested.
 */

import { t, type Locale } from "../telegram/i18n.js";
import { MUXEL_VERSION } from "../version.js";
import type { WebChannel } from "./channel.js";

function escapeJson(value: unknown): string {
  // Inlined into a script, so the sequence that could end it early is escaped.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Colours derived from the operator's single accent choice. */
function palette(accent: string): { accent: string; onAccent: string } {
  const hex = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#2563eb";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Rec. 709 luminance: a pale accent needs dark text on it, and asking the
  // operator to pick a text colour as well is a question they cannot answer.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return { accent: hex, onAccent: luminance > 0.6 ? "#111827" : "#ffffff" };
}

export function widgetScript(input: {
  origin: string;
  channel: WebChannel;
  locale?: Locale;
}): string {
  const { accent, onAccent } = palette(input.channel.accent);
  const title = input.channel.title.length > 0 ? input.channel.title : "Chat with us";
  const config = {
    api: `${input.origin}/w/${input.channel.key}`,
    title,
    greeting: input.channel.greeting,
    // Written in the business's own language rather than the visitor's,
    // because a shop knows who it serves and a browser setting does not.
    teaser: t(input.locale ?? "en", "webTeaser", { name: title }),
    accent,
    onAccent,
  };

  return `(function () {
  "use strict";
  if (window.__muxelWidget) { return; }
  window.__muxelWidget = true;
  var C = ${escapeJson(config)};

  var KEY = "muxel.session." + C.api;
  var session = "";
  try { session = localStorage.getItem(KEY) || ""; } catch (e) { session = ""; }

  var host = document.createElement("div");
  host.setAttribute("data-muxel", "");
  host.style.cssText = "position:fixed;bottom:0;right:0;z-index:2147483000";
  var root = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  root.innerHTML = [
    "<style>",
    ":host,*{box-sizing:border-box}",
    ".b{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border:0;border-radius:50%;",
    "background:", C.accent, ";color:", C.onAccent, ";cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.28);",
    "display:flex;align-items:center;justify-content:center}",
    ".b svg{width:26px;height:26px;fill:currentColor}",
    // The teaser. A speech bubble beside the launcher, with a tail pointing at
    // it, so it reads as the assistant speaking rather than as an advert.
    ".t{position:fixed;bottom:30px;right:88px;max-width:256px;background:#fff;color:#111827;",
    "padding:11px 30px 11px 14px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18);",
    "font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:none;",
    "opacity:0;transform:translateY(6px);transition:opacity .28s ease,transform .28s ease}",
    ".t.s{display:block}",
    ".t.v{opacity:1;transform:none}",
    ".t:after{content:'';position:absolute;right:-6px;bottom:16px;width:12px;height:12px;",
    "background:inherit;transform:rotate(45deg)}",
    ".t.l:after{right:auto;left:-6px}",
    ".t button{position:absolute;top:3px;right:5px;background:transparent;border:0;color:#9ca3af;",
    "font-size:17px;line-height:1;cursor:pointer;padding:2px 4px}",
    ".t span{cursor:pointer;display:block}",
    // Compact on a phone. A 360 pixel panel and a 56 pixel button were drawn
    // for a desktop corner; on a handset they cover the page the visitor is
    // trying to read, and a teaser sized for a laptop pushes the bubble off
    // the screen entirely.
    "@media (max-width:480px){",
    ".b{width:48px;height:48px;bottom:16px;right:16px}",
    ".b svg{width:22px;height:22px}",
    ".p{width:auto;left:10px;right:10px;bottom:74px;max-width:none;",
    "height:auto;top:12px;max-height:none;border-radius:12px;font-size:14px}",
    ".h{padding:11px 13px}",
    ".m{padding:11px;gap:8px}",
    ".r{max-width:90%;padding:8px 11px}",
    ".f{padding:8px}",
    ".f input{padding:9px 11px}",
    ".t{max-width:min(66vw,220px);font-size:13px;line-height:1.4;",
    "padding:9px 26px 9px 12px;bottom:22px;right:74px}",
    ".t button{font-size:16px}",
    "}",
    ".p{position:fixed;bottom:88px;right:20px;width:360px;max-width:calc(100vw - 32px);",
    "height:520px;max-height:calc(100vh - 120px);background:#fff;color:#111827;border-radius:14px;",
    "box-shadow:0 12px 48px rgba(0,0,0,.24);display:none;flex-direction:column;overflow:hidden;",
    "font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}",
    ".p.o{display:flex}",
    ".h{background:", C.accent, ";color:", C.onAccent, ";padding:14px 16px;font-weight:600;",
    "display:flex;align-items:center;justify-content:space-between}",
    ".h button{background:transparent;border:0;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:0 4px}",
    ".m{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}",
    ".r{max-width:85%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}",
    ".r.u{align-self:flex-end;background:", C.accent, ";color:", C.onAccent, "}",
    ".r.a{align-self:flex-start;background:#f1f3f5;color:#111827}",
    ".r.e{align-self:center;background:transparent;color:#9ca3af;font-size:13px;text-align:center}",
    ".f{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}",
    ".f input{flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:9px;font:inherit;color:#111827;background:#fff}",
    ".f input:focus{outline:2px solid ", C.accent, ";outline-offset:-1px}",
    ".f button{background:", C.accent, ";color:", C.onAccent, ";border:0;border-radius:9px;padding:0 16px;font:inherit;font-weight:600;cursor:pointer}",
    ".f button:disabled{opacity:.55;cursor:default}",
    ".d{align-self:flex-start;display:flex;gap:4px;padding:11px 12px}",
    ".d i{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:x 1.2s infinite}",
    ".d i:nth-child(2){animation-delay:.15s}.d i:nth-child(3){animation-delay:.3s}",
    "@keyframes x{0%,60%,100%{opacity:.3}30%{opacity:1}}",
    "@media (prefers-color-scheme:dark){",
    ".p{background:#1f2225;color:#e8eaed}.r.a{background:#2f3336;color:#e8eaed}",
    ".f{background:#1f2225;border-top-color:#3c4043}",
    ".t{background:#1f2225;color:#e8eaed}",
    ".f input{background:#2f3336;border-color:#3c4043;color:#e8eaed}}",
    "</style>",
    '<aside class="t"><span></span><button aria-label="Dismiss">&times;</button></aside>',
    '<button class="b" part="button" aria-label="', C.title, '">',
    '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.4 1.2 4.6 3.1 6.1L4 22l4.7-2.2c1 .3 2.1.4 3.3.4 5.5 0 10-3.8 10-8.7S17.5 3 12 3z"/></svg>',
    "</button>",
    '<section class="p" role="dialog" aria-label="', C.title, '">',
    '<div class="h"><span></span><button aria-label="Close">&times;</button></div>',
    '<div class="m"></div>',
    '<form class="f"><input type="text" autocomplete="off" placeholder="Type a message" /><button type="submit">Send</button></form>',
    "</section>",
  ].join("");

  var bubble = root.querySelector(".b");
  var teaser = root.querySelector(".t");
  var panel = root.querySelector(".p");
  var list = root.querySelector(".m");
  var form = root.querySelector(".f");
  var input = form.querySelector("input");
  var send = form.querySelector("button");
  root.querySelector(".h span").textContent = C.title;
  root.querySelector(".h button").onclick = function () { toggle(false); };

  var lastSeen = 0;
  var polling = null;
  var greeted = false;
  // Whether a message of ours is out and unanswered. The answer to /send is
  // what draws that turn — the reply, and the seq that covers both rows — so
  // while it is out the poll has nothing to add. Left to run, a poll that
  // landed during the model's few seconds of thinking found the row this
  // widget had already drawn and drew it again, so a customer saw their own
  // question twice.
  var sending = false;

  function bubbleFor(text, who) {
    var el = document.createElement("div");
    el.className = "r " + who;
    el.textContent = text;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    return el;
  }

  function typing(on) {
    var existing = root.querySelector(".d");
    if (!on) { if (existing) { existing.remove(); } return; }
    if (existing) { return; }
    var el = document.createElement("div");
    el.className = "d";
    el.innerHTML = "<i></i><i></i><i></i>";
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
  }

  function remember(id) {
    session = id;
    try { localStorage.setItem(KEY, id); } catch (e) { /* private mode */ }
  }

  // Every row is drawn once, and the seq is the record of how far that has
  // got. A poll answered late, after a send has already moved lastSeen past
  // its rows, brings nothing new.
  function show(messages) {
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i];
      if (m.seq <= lastSeen) { continue; }
      lastSeen = m.seq;
      bubbleFor(m.text, m.role === "user" ? "u" : "a");
    }
  }

  // Only while the panel is open, and only to collect what a person typed on
  // the other side. A closed widget costs the shop nothing.
  function poll() {
    if (!session || sending) { return; }
    fetch(C.api + "/poll?session=" + encodeURIComponent(session) + "&after=" + lastSeen, {
      method: "GET",
      credentials: "omit",
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        // Asked before the send went out and answered during it: the send's
        // own answer covers whatever this found.
        if (sending) { return; }
        if (d && d.messages && d.messages.length) { show(d.messages); }
      })
      .catch(function () { /* a dropped poll is retried by the next one */ });
  }

  function toggle(open) {
    panel.classList.toggle("o", open);
    if (!open) {
      if (polling) { clearInterval(polling); polling = null; }
      return;
    }
    // Opening the chat answers the invitation, so it gets out of the way.
    hideTeaser();
    positionPanel();
    input.focus();
    if (!greeted) {
      greeted = true;
      if (C.greeting) { bubbleFor(C.greeting, "a"); }
    }
    if (session) { poll(); }
    polling = setInterval(poll, 6000);
  }

  // The teaser ----------------------------------------------------------------
  //
  // A bubble in the corner is scenery, and a visitor with a question walks past
  // it. A line that names the shop and offers help is an invitation. It arrives
  // a few seconds in rather than on load, so it does not compete with the page
  // the visitor came to read, and once dismissed it stays dismissed.
  // Offered again on every visit. A dismissal closes it for this page, not for
  // good: the operator wants the invitation in front of every visitor, and a
  // customer who waved it away while browsing may well have a question by the
  // time they reach the next page.
  var TEASER_DELAY_MS = 4000;
  var teaserText = root.querySelector(".t span");
  var teaserTimer = null;
  teaserText.textContent = C.teaser || "";

  function hideTeaser() {
    if (teaserTimer) { clearTimeout(teaserTimer); teaserTimer = null; }
    teaser.classList.remove("v");
    setTimeout(function () { teaser.classList.remove("s"); }, 280);
  }

  function showTeaser() {
    if (!C.teaser || panel.classList.contains("o")) { return; }
    placeTeaser();
    teaser.classList.add("s");
    // A frame between display and opacity, or the transition never runs.
    requestAnimationFrame(function () { teaser.classList.add("v"); });
  }

  /** Keeps the teaser beside the bubble, flipping sides when it would overflow. */
  function placeTeaser() {
    if (!placed) { return; }
    var w = bubble.offsetWidth || 56;
    var tw = teaser.offsetWidth || 256;
    var left = placed.x - tw - 12;
    var flip = left < 8;
    teaser.classList.toggle("l", flip);
    teaser.style.left = (flip ? placed.x + w + 12 : left) + "px";
    teaser.style.top = Math.max(8, placed.y - 6) + "px";
    teaser.style.right = "auto";
    teaser.style.bottom = "auto";
  }

  if (C.teaser) {
    teaserTimer = setTimeout(showTeaser, TEASER_DELAY_MS);
  }

  // Reading the line and then having to find the button is a step too many.
  teaserText.onclick = function () { hideTeaser(); toggle(true); };
  root.querySelector(".t button").onclick = function (event) {
    event.stopPropagation();
    hideTeaser();
  };

  // Dragging ------------------------------------------------------------------
  //
  // The corner the shop chose is not always the corner a visitor needs. The
  // bubble sits over whatever the page put there, and on a phone that is often
  // the checkout button. So it can be moved, and where it is moved to is
  // remembered for next time.
  //
  // A press that moves less than a few pixels is still a press: fingers are not
  // precise, and a bubble that opened nothing because the thumb slid two pixels
  // would read as broken.
  var POS = "muxel.pos." + C.api;
  var DRAG_SLOP = 5;
  var EDGE = 8;
  var placed = null;
  var drag = null;

  function clampTo(x, y) {
    var w = bubble.offsetWidth || 56;
    var h = bubble.offsetHeight || 56;
    return {
      x: Math.max(EDGE, Math.min(x, window.innerWidth - w - EDGE)),
      y: Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE)),
    };
  }

  function placeAt(x, y) {
    placed = clampTo(x, y);
    bubble.style.left = placed.x + "px";
    bubble.style.top = placed.y + "px";
    bubble.style.right = "auto";
    bubble.style.bottom = "auto";
    positionPanel();
    placeTeaser();
  }

  /** True on a handset, where the panel fills the screen from the stylesheet. */
  function narrow() { return window.innerWidth <= 480; }

  /** Keeps the panel beside the bubble, on whichever side has room. */
  function positionPanel() {
    if (narrow()) {
      // The stylesheet already gives the panel the whole screen here. Placing
      // it from script would shrink it back to a desktop card on a phone.
      panel.style.left = "";
      panel.style.top = "";
      panel.style.right = "";
      panel.style.bottom = "";
      return;
    }
    if (!placed) { return; }
    var w = bubble.offsetWidth || 56;
    var h = bubble.offsetHeight || 56;
    var pw = Math.min(360, window.innerWidth - 32);
    var ph = panel.offsetHeight || Math.min(520, window.innerHeight - 120);
    var left = placed.x + w / 2 - pw / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - pw - 16));
    var above = placed.y > ph + 16;
    var top = above ? placed.y - ph - 12 : placed.y + h + 12;
    top = Math.max(16, Math.min(top, window.innerHeight - ph - 16));
    panel.style.left = left + "px";
    panel.style.top = top + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  try {
    var saved = JSON.parse(localStorage.getItem(POS) || "null");
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      placeAt(saved.x, saved.y);
    }
  } catch (e) { /* a corrupt position is simply the default one */ }

  bubble.addEventListener("pointerdown", function (event) {
    if (event.button !== undefined && event.button !== 0) { return; }
    var rect = bubble.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false,
             x0: event.clientX, y0: event.clientY };
    try { bubble.setPointerCapture(event.pointerId); } catch (e) { /* older engines */ }
  });

  bubble.addEventListener("pointermove", function (event) {
    if (!drag) { return; }
    if (!drag.moved &&
        Math.abs(event.clientX - drag.x0) < DRAG_SLOP &&
        Math.abs(event.clientY - drag.y0) < DRAG_SLOP) { return; }
    drag.moved = true;
    // Only now is this a drag, so only now does the page stop scrolling.
    event.preventDefault();
    placeAt(event.clientX - drag.dx, event.clientY - drag.dy);
  });

  function endDrag(event) {
    if (!drag) { return; }
    var moved = drag.moved;
    drag = null;
    try { bubble.releasePointerCapture(event.pointerId); } catch (e) { /* ignored */ }
    if (!moved) {
      toggle(!panel.classList.contains("o"));
      return;
    }
    try { localStorage.setItem(POS, JSON.stringify(placed)); } catch (e) { /* private mode */ }
  }

  bubble.addEventListener("pointerup", endDrag);
  bubble.addEventListener("pointercancel", endDrag);
  bubble.style.touchAction = "none";

  // A window that shrinks below a bubble parked at its edge would strand it
  // offscreen, where nothing can bring it back.
  window.addEventListener("resize", function () {
    if (placed) { placeAt(placed.x, placed.y); }
  });

  form.onsubmit = function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) { return; }
    // One turn at a time. The button is disabled while a send is out, but
    // Enter submits the form regardless of the button, and a second Enter —
    // easy to press twice from an input method that uses it to commit — sent
    // the same question twice, to be stored and answered twice. What was typed
    // stays in the box for when the reply has arrived.
    if (sending) { return; }
    input.value = "";
    bubbleFor(text, "u");
    send.disabled = true;
    sending = true;
    typing(true);

    fetch(C.api + "/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ session: session, text: text }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        typing(false);
        send.disabled = false;
        if (res.d && res.d.session) { remember(res.d.session); }
        // Moved before the poll is let back in, so the rows this turn wrote
        // are already behind it.
        if (res.d && typeof res.d.seq === "number") { lastSeen = res.d.seq; }
        sending = false;
        if (res.ok && res.d && res.d.reply) { bubbleFor(res.d.reply, "a"); return; }
        bubbleFor((res.d && res.d.error) || "Something went wrong. Please try again.", "e");
      })
      .catch(function () {
        typing(false);
        send.disabled = false;
        sending = false;
        bubbleFor("Could not reach us just now. Please try again.", "e");
      });
  };
})();
`;
}

/**
 * A page that is nothing but the widget.
 *
 * This is where an operator meets their own assistant as a customer meets it,
 * on their own address, before it goes anywhere near their site. Describing
 * the experience never persuaded anyone; letting them press the bubble does.
 */
export function previewPage(input: { origin: string; channel: WebChannel }): string {
  const { accent } = palette(input.channel.accent);
  const title = input.channel.title.length > 0 ? input.channel.title : "Chat with us";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 16px/1.6 ui-sans-serif, system-ui, sans-serif;
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: light-dark(#f6f7f9, #17191c); color: light-dark(#111827, #e8eaed);
    padding: 2rem;
  }
  main { max-width: 30rem; text-align: center; }
  h1 { font-size: 1.3rem; margin-bottom: .4rem; }
  p { opacity: .7; margin-top: 0; }
  .dot { display:inline-block; width:.6rem; height:.6rem; border-radius:50%; background:${accent}; }
</style>
</head>
<body>
<main>
  <h1><span class="dot"></span> ${escapeHtml(title)}</h1>
  <p>This is your assistant exactly as a visitor to your website will meet it.
  Press the bubble in the corner and ask it something your documents cover.</p>
  <p>Nothing here is public: this page is not indexed, and it is only reachable
  by anyone you give the address to.</p>
</main>
<script src="${input.origin}/w/${input.channel.key}/widget.js?v=${encodeURIComponent(MUXEL_VERSION)}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
