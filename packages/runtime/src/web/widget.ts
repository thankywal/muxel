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

export function widgetScript(input: { origin: string; channel: WebChannel }): string {
  const { accent, onAccent } = palette(input.channel.accent);
  const config = {
    api: `${input.origin}/w/${input.channel.key}`,
    title: input.channel.title.length > 0 ? input.channel.title : "Chat with us",
    greeting: input.channel.greeting,
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
    ".f input{background:#2f3336;border-color:#3c4043;color:#e8eaed}}",
    "</style>",
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

  function show(messages) {
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i];
      if (m.seq > lastSeen) { lastSeen = m.seq; }
      bubbleFor(m.text, m.role === "user" ? "u" : "a");
    }
  }

  // Only while the panel is open, and only to collect what a person typed on
  // the other side. A closed widget costs the shop nothing.
  function poll() {
    if (!session) { return; }
    fetch(C.api + "/poll?session=" + encodeURIComponent(session) + "&after=" + lastSeen, {
      method: "GET",
      credentials: "omit",
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.messages && d.messages.length) { show(d.messages); } })
      .catch(function () { /* a dropped poll is retried by the next one */ });
  }

  function toggle(open) {
    panel.classList.toggle("o", open);
    if (!open) {
      if (polling) { clearInterval(polling); polling = null; }
      return;
    }
    input.focus();
    if (!greeted) {
      greeted = true;
      if (C.greeting) { bubbleFor(C.greeting, "a"); }
    }
    if (session) { poll(); }
    polling = setInterval(poll, 6000);
  }

  bubble.onclick = function () { toggle(!panel.classList.contains("o")); };

  form.onsubmit = function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) { return; }
    input.value = "";
    bubbleFor(text, "u");
    send.disabled = true;
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
        if (res.d && typeof res.d.seq === "number") { lastSeen = res.d.seq; }
        if (res.ok && res.d && res.d.reply) { bubbleFor(res.d.reply, "a"); return; }
        bubbleFor((res.d && res.d.error) || "Something went wrong. Please try again.", "e");
      })
      .catch(function () {
        typing(false);
        send.disabled = false;
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
<script src="${input.origin}/w/${input.channel.key}/widget.js"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
