/**
 * The Muxel console.
 *
 * Every number, row and label on these pages is counted from the deployment's
 * own database at the moment it is asked for. Where the design called for
 * something this product does not have, the page says what it has instead: the
 * channel list is Telegram and the web widget because that is what Muxel
 * answers on, and the agent score is the share of conversations that never
 * needed a person, because that is a fact the handover table holds. A dashboard
 * that fills its gaps with plausible numbers is worse than a smaller one.
 *
 * Nothing is stored on the server that served this page. The deployment's
 * address and the operator's token live in this browser and are sent with each
 * request.
 */
const $ = (id) => document.getElementById(id);
const KEY = "muxel.worker";
const TOK = "muxel.token";
const THEME = "muxel.theme";
let worker = localStorage.getItem(KEY) || "";
let token = localStorage.getItem(TOK) || "";

/** Everything from the deployment is escaped. It is the operator's data. */
const h = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  /** Whether the deployment answers the data API. Asked once, read everywhere. */
  api: null,
  /** What the deployment's data API can do. See NEEDS. */
  apiRevision: 1,
  // The assistant is the front door: entering the console puts you in a
  // conversation with your own agent, the way entering a chat app does.
  view: "assistant",
  businessId: null,
  customerId: null,
  overview: null,
  models: [],
  conversation: null,
  poll: null,
  page: 1,
  filter: "all",
  settingsTab: "general",
  health: null,
  /** The top screen's own destinations, asked for once. */
  advNav: null,
  advHome: null,
  advTrail: [],
  /** How many conversations are waiting, for the badge beside Inbox. */
  waiting: 0,
  bizTab: "overview",
  /** Which question the Customers screen is asking: everyone, or who is waiting. */
  custTab: "all",
  agentTab: "model",
  agent: null,
  openCustomer: null,
  skills: null,
  assistant: null,
  /** Conversations with the assistant, for the rail. Asked for once. */
  chats: null,
  chatId: null,
  chatModel: null,
  /** The last model this browser saw chosen, so the name is right on first paint. */
  lastModel: localStorage.getItem("muxel.model") ?? null,
  /** Pressed New chat and not yet said anything. */
  newChat: false,
  /** The repeating check for a line from upstream. Started once. */
  noticeTimer: null,
  /** The turn in flight, so the stop square has something to stop. */
  pending: null,
  stopped: false,
  locale: "en",
};

// ------------------------------------------------------------------ plumbing

/**
 * One call, from this browser to the owner's own Worker.
 *
 * Not through the server that served this page. That server has no proxy, sees
 * no token and no message, and could be switched off with every connected
 * console still working. It is the claim on the front page made literal: there
 * is no server of ours in the path.
 *
 * The Worker answers every one of these with `access-control-allow-origin: *`,
 * which is safe because each path already refuses anyone without that
 * deployment's own bearer token.
 */
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${worker}/admin/api/${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.body !== undefined && !options.raw ? { "content-type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: options.raw ? options.body : JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // Stopping is the caller's own decision, so it is reported as such rather
    // than as a deployment that could not be reached.
    if (error?.name === "AbortError") return { ok: false, status: -1, data: {}, aborted: true };
    // A deployment old enough to predate these paths also predates the cross
    // origin headers they need, so the browser refuses the call before it is
    // made. That is indistinguishable from a deployment being offline, and
    // both mean the same thing to every caller: no answer. Status 0 says so
    // without any of them having to know which it was.
    return { ok: false, status: 0, data: {} };
  }
  if (options.blob) {
    return { ok: response.ok, status: response.status, data: response.ok ? await response.blob() : null };
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // A deployment older than this console answers "not found" in plain text.
    // Reading that as {} is how Settings once reported a version it never saw.
    data = null;
  }
  if (!response.ok && data !== null && !options.quiet) {
    toast(data.message || data.error || "That did not work.");
  }
  return { ok: response.ok, status: response.status, data: data ?? {} };
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const num = (n) => Number(n ?? 0).toLocaleString();
const nameOf = (c) => c?.displayName || (c?.username ? `@${c.username}` : "") || c?.name || "Someone";

const ICONS = {
  overview: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z"/>',
  assistant: '<path d="M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4z"/><path d="M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/>',
  diagnostics: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  agents: '<rect x="3.5" y="8" width="17" height="11" rx="3.5"/><path d="M12 3.5v4.5M8.5 13h.01M15.5 13h.01"/><circle cx="12" cy="3" r="1.4"/><path d="M1.5 12v3M22.5 12v3"/>',
  businesses: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5"/>',
  channels: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  customers: '<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9"/>',
  messages: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logs: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  advanced: '<path d="M8 3H5a2 2 0 0 0-2 2v3m0 8v3a2 2 0 0 0 2 2h3m8-18h3a2 2 0 0 1 2 2v3m0 8v3a2 2 0 0 1-2 2h-3"/><path d="M9 9h6v6H9z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  telegram: '<path d="M22 3L2 10l6 2.5L20 6l-9 9v5l3-4 5 3z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  retry: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  attach: '<path d="M21.4 11.05 12.2 20.2a5 5 0 0 1-7.1-7.1l9.2-9.1a3.3 3.3 0 1 1 4.7 4.7l-9.2 9.2a1.7 1.7 0 0 1-2.4-2.4l8.5-8.4"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4-.8L3 21l1.9-4.6A8.3 8.3 0 0 1 3.6 11.5 8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M21 14v7H3V3h7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (name, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
     stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;

// -------------------------------------------------------------------- charts

/** A line with no axes, drawn from the same numbers the panel below prints. */
function sparkline(values, colour, w = 74, hgt = 26) {
  const nums = values.length > 0 ? values : [0];
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const span = max - min || 1;
  const step = nums.length > 1 ? w / (nums.length - 1) : w;
  const points = nums.map((v, i) => `${(i * step).toFixed(1)},${(hgt - ((v - min) / span) * hgt).toFixed(1)}`);
  return `<svg class="spark" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}" fill="none">
    <polyline points="${points.join(" ")}" stroke="${colour}" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function lineChart(series, w = 560, hgt = 170) {
  // A day that has not happened has no point on it. Drawing the frame anyway
  // produced a path that began at the closing corner, which is not a shape a
  // browser will accept, and a chart of nothing is not worth the pixels.
  if (series.length === 0) {
    return `<div class="no-chart" style="height:${hgt}px">No days recorded yet.</div>`;
  }
  const values = series.map((p) => p.messages);
  const max = Math.max(...values, 1);
  const padL = 44;
  const padB = 22;
  const innerW = w - padL - 8;
  const innerH = hgt - padB - 8;
  const step = series.length > 1 ? innerW / (series.length - 1) : innerW;
  const pt = (v, i) => [padL + i * step, 8 + innerH - (v / max) * innerH];
  const points = values.map(pt);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${path} L${(padL + innerW).toFixed(1)} ${(8 + innerH).toFixed(1)} L${padL} ${(8 + innerH).toFixed(1)} Z`;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  return `<svg width="100%" viewBox="0 0 ${w} ${hgt}" fill="none" preserveAspectRatio="none" style="display:block">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--brand)" stop-opacity=".18"/>
      <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
    ${ticks
      .map((t, i) => {
        const y = 8 + innerH - (i / 2) * innerH;
        return `<line x1="${padL}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="var(--line-soft)" stroke-width="1"/>
                <text x="${padL - 7}" y="${y + 3.5}" font-size="9.5" text-anchor="end" fill="var(--muted)">${num(t)}</text>`;
      })
      .join("")}
    <path d="${area}" fill="url(#fade)"/>
    <path d="${path}" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${series
      .map((p, i) => {
        if (series.length > 8 && i % 2 === 1) return "";
        return `<text x="${(padL + i * step).toFixed(1)}" y="${hgt - 5}" font-size="9.5"
          fill="var(--muted)" text-anchor="middle">${p.day.slice(5)}</text>`;
      })
      .join("")}
  </svg>`;
}

function donut(parts, total) {
  const size = 150;
  const r = 54;
  const c = 2 * Math.PI * r;
  let used = 0;
  const arcs = parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const frac = total === 0 ? 0 : p.value / total;
      const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.colour}"
        stroke-width="17" stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}"
        stroke-dashoffset="${(-used * c).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
      used += frac;
      return seg;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="17"/>
    ${arcs}
    <text x="${size / 2}" y="${size / 2 - 2}" text-anchor="middle" font-size="19" font-weight="700"
      fill="var(--ink)">${num(total)}</text>
    <text x="${size / 2}" y="${size / 2 + 15}" text-anchor="middle" font-size="10.5"
      fill="var(--muted)">messages</text></svg>`;
}

// --------------------------------------------------------------------- shell

/**
 * The rail, which is the work.
 *
 * The assistant is not in it, because the assistant is the page you land on and
 * the chat list below is how you move between conversations. Settings,
 * Diagnostics and the logs are not in it either: they are things you do a few
 * times ever, and they live behind the owner's own badge at the bottom, where
 * a person already looks for their account.
 */
const NAV = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "businesses", label: "Businesses" },
  { id: "customers", label: "Customers" },
];

/** Behind the badge: the things an owner sets up once and rarely returns to. */
const OWNER_MENU = [
  { id: "settings", label: "Settings" },
  { id: "channels", label: "Channels" },
  { id: "logs", label: "Logs" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "advanced", label: "The bot's own screens" },
];

/**
 * Every destination, including the ones that are no longer their own rail item.
 *
 * Messages is reached by opening a person's chat from Customers, and Inbox is
 * the Waiting tab on that same screen. Both keep their own view and their own
 * place in search, because a screen that can be linked to has to be able to
 * draw itself.
 */
const ALL_VIEWS = [
  ...NAV,
  ...OWNER_MENU,
  { id: "assistant", label: "Assistant" },
  { id: "messages", label: "Messages" },
  { id: "inbox", label: "Waiting for you" },
];

/**
 * The API revision each page needs from the deployment.
 *
 * The console updates on its own and the deployment updates when its owner
 * presses a button, so the two are routinely out of step. A page that needs
 * more than the deployment has says so, with the one button that fixes it,
 * rather than asking for a path that is not there and showing a 404.
 */
const NEEDS = {
  overview: 1,
  businesses: 1,
  messages: 1,
  settings: 1,
  advanced: 1,
  inbox: 2,
  assistant: 13,
  /** Not a page: the two panels in Settings for keys to services outside. */
  outside: 14,
  diagnostics: 2,
  logs: 2,
  channels: 2,
  customers: 2,
  agents: 4,
};

const TITLES = {
  overview: ["Overview", "Monitor your agents, channels, and conversations."],
  inbox: ["Waiting for you", "Conversations a customer is waiting on a person for."],
  assistant: ["Assistant", "It reads everything, and changes nothing without asking you first."],
  diagnostics: ["Diagnostics", "What this deployment can and cannot do right now."],
  agents: ["Agents", "Create and manage the assistants that answer for you."],
  businesses: ["Businesses", "What each agent answers about, and where it answers."],
  channels: ["Channels", "Every way a customer can reach this deployment."],
  customers: ["Customers", "Everyone who has written, and the ones still waiting on you."],
  messages: ["Messages", "Read any conversation, and step into it when you want to."],
  settings: ["Settings", "What this deployment is running, and how it updates itself."],
  logs: ["Logs", "What this deployment recorded, newest first."],
  advanced: [
    "The bot's own screens",
    "The Telegram console, exactly as it sends it. Everything here has a page of its own in this console; this is the fallback, and where a screen the bot grows tomorrow turns up first.",
  ],
};

function shell() {
  const [title, sub] = TITLES[state.view] ?? TITLES.overview;
  const chatting = state.view === "assistant";
  $("shell").innerHTML = `
   <div class="shell">
    <aside>
      <div class="brand"><img src="/assets/logo.png" alt="">
        <div><b>Muxel</b><small>CONSOLE</small></div></div>

      <button class="new-chat" id="newChat">${icon("plus", 15)}New chat</button>

      <nav>${NAV.map(
        (item) => `<div class="nav-item ${item.id === state.view ? "on" : ""}" data-view="${item.id}">
            ${icon(item.id)}${h(item.label)}${
              item.id === "customers" && state.waiting > 0
                ? `<span class="badge">${state.waiting}</span>`
                : ""
            }</div>`,
      ).join("")}</nav>

      <div class="chats" id="chatList">${chatRail()}</div>

      <button class="who-card" id="ownerBadge" aria-haspopup="menu">
        <span class="av" id="avatar">·</span>
        <span class="grow"><b id="whoName">Operator</b><small id="whoRole">signed in</small></span>
        ${icon("chevron", 15)}
      </button>
    </aside>
    <div class="rail-veil" id="railVeil"></div>

    <main class="${chatting ? "chatting" : ""}">
      <div class="topbar">
        <!--
          The way back to the navigation on a narrow screen. The rail is off
          canvas there, and without this there was no way to reach Overview,
          Businesses or a past chat at all: the page you landed on was the page
          you were stuck with.
        -->
        <button class="icon-btn rail-open" id="railOpen" aria-label="Menu">${icon("menu", 18)}</button>
        ${
          chatting
            ? `<button class="model-pick" id="modelPick">
                 <span id="modelName">${h(modelLabel())}</span>${icon("chevron", 14)}</button>`
            : `<div><h1>${h(title)}</h1><p>${h(sub)}</p></div>`
        }
        <div class="grow"></div>
        <div class="top-tools">
          <div class="searchbox" id="openPalette">${icon("search", 15)}<span>Search…</span><kbd>⌘K</kbd></div>
          <span class="pill" id="healthPill"><span class="d"></span>Checking…</span>
          <button class="icon-btn" id="bell" title="Recent activity">${icon("bell", 16)}</button>
          <button class="icon-btn" id="themeBtn" title="Theme">${icon(themeNow() === "dark" ? "sun" : "moon", 16)}</button>
        </div>
      </div>
      <div class="content" id="view">${waitingMark()}</div>
      ${
        chatting
          ? ""
          : `<footer>
        <span>Muxel runs in your own Cloudflare account.</span>
        <span class="grow"></span>
        <a href="https://github.com/thankywal/muxel" target="_blank" rel="noopener">GitHub</a>
        <a href="https://muxel.site" target="_blank" rel="noopener">Docs</a>
      </footer>`
      }
    </main>
   </div>`;

  // Opening the drawer, and every way of closing it again. A drawer that only
  // closes by its own button is a trap on a phone, where the thing you want is
  // usually the page behind it.
  // The class goes on the .shell the CSS actually selects, which is the div
  // inside #shell rather than #shell itself. Putting it on the wrapper toggled
  // a class nothing was listening for: the drawer stayed shut and said nothing.
  const railBox = $("shell").querySelector(".shell");
  const rail = (on) => railBox?.classList.toggle("rail-on", on);
  $("railOpen").onclick = () => rail(true);
  $("railVeil").onclick = () => rail(false);
  $("shell").querySelectorAll(".nav-item").forEach(
    (n) => (n.onclick = () => { rail(false); go(n.dataset.view); }),
  );
  $("newChat").onclick = () => { rail(false); openChat(null); };
  $("ownerBadge").onclick = openOwnerMenu;
  $("openPalette").onclick = openPalette;
  $("themeBtn").onclick = toggleTheme;
  $("bell").onclick = () => go("logs");
  if ($("modelPick")) $("modelPick").onclick = openModelMenu;
  bindChatRail();
  checkHealth();
  whoAmI();
  showNotice();
}

/** How often the console asks whether there is anything to say. */
const NOTICE_EVERY_MS = 5 * 60_000;
const NOTICE_SEEN = "muxel.notice.seen";

/**
 * A line from the people who wrote Muxel, at the top of the console.
 *
 * Pulled, never pushed. There is no list of deployments and there is not going
 * to be one, so nobody can be sent anything: the console is already served from
 * this host, and it asks that host whether there is a line to show. No
 * deployment is contacted, identified or written down by any of it.
 *
 * Dismissal is remembered against the notice's id, in this browser, so a new
 * notice needs a new id to be seen by somebody who dismissed the last one.
 */
async function showNotice() {
  if (state.noticeTimer === null) {
    state.noticeTimer = setInterval(showNotice, NOTICE_EVERY_MS);
  }
  let notice;
  try {
    const response = await fetch(`/notice.json?t=${Math.floor(Date.now() / NOTICE_EVERY_MS)}`);
    if (!response.ok) return;
    notice = await response.json();
  } catch {
    // Nothing to say is the same as not being able to ask. Neither is worth
    // telling the owner about; they came here to run their shop.
    return;
  }
  const id = String(notice.id ?? "").trim();
  const text = String(notice.text ?? "").trim();
  if (id.length === 0 || text.length === 0) return dropNotice();
  if (readSeen().includes(id)) return dropNotice();

  dropNotice();
  const bar = document.createElement("div");
  bar.className = `notice ${notice.kind === "update" ? "update" : ""}`;
  bar.id = "notice";
  bar.innerHTML = `${icon(notice.kind === "update" ? "settings" : "bell", 16)}
    <span class="grow">${h(text)}</span>
    ${notice.action === "update" ? '<button class="btn btn-sm" id="noticeGo">Update now</button>' : ""}
    <button class="notice-x" id="noticeX" aria-label="Dismiss">&times;</button>`;
  document.querySelector(".shell")?.prepend(bar);
  if ($("noticeGo")) {
    $("noticeGo").onclick = () => {
      state.settingsTab = "deployment";
      go("settings");
    };
  }
  $("noticeX").onclick = () => {
    localStorage.setItem(NOTICE_SEEN, JSON.stringify([...readSeen(), id].slice(-30)));
    dropNotice();
  };
}

const dropNotice = () => document.getElementById("notice")?.remove();

function readSeen() {
  try {
    const held = JSON.parse(localStorage.getItem(NOTICE_SEEN) ?? "[]");
    return Array.isArray(held) ? held : [];
  } catch {
    return [];
  }
}

/** The conversations with the assistant, newest first, under the rail. */
function chatRail() {
  const chats = state.chats ?? [];
  if (chats.length === 0) return '<div class="chats-empty">No conversations yet</div>';
  return (
    '<div class="nav-sec">CHATS</div>' +
    chats
      .map(
        (c) => `<div class="chat-row ${
          c.id === state.chatId && state.view === "assistant" ? "on" : ""
        }" data-chat="${h(c.id)}">
            <span class="t">${h(c.title || "Untitled")}</span>
            <button class="x" data-drop="${h(c.id)}" title="Delete">${icon("trash", 13)}</button>
          </div>`,
      )
      .join("")
  );
}

function bindChatRail() {
  const list = $("chatList");
  if (!list) return;
  list.querySelectorAll("[data-chat]").forEach((row) => {
    row.onclick = (event) => {
      if (event.target.closest("[data-drop]")) return;
      document.querySelector(".shell")?.classList.remove("rail-on");
      openChat(row.dataset.chat);
    };
  });
  list.querySelectorAll("[data-drop]").forEach((b) => {
    b.onclick = async (event) => {
      event.stopPropagation();
      const choice = await ask("Delete this conversation", "It is removed for good. Nothing you approved is undone.", [
        { key: "yes", label: "Delete", primary: true },
      ]);
      if (!choice) return;
      await api(`assistant/chats/${encodeURIComponent(b.dataset.drop)}`, { method: "DELETE" });
      if (state.chatId === b.dataset.drop) state.chatId = null;
      state.assistant = null;
      go("assistant");
    };
  });
}

/** Open a conversation, or a blank one when given null. */
function openChat(chatId) {
  state.chatId = chatId;
  state.newChat = chatId === null;
  state.assistant = null;
  go("assistant");
}

/**
 * The model this conversation is on, by the name a person would use.
 *
 * The list is remembered across views, so the picker and the head of a reply
 * both have a real name before the assistant's own payload has arrived. When
 * even the list is missing it falls back to the last part of the model's id,
 * which is still the model — "Model" was a label for nothing.
 */
const modelLabel = () => {
  const chosen =
    state.chatModel ?? state.assistant?.chat?.model ?? state.assistant?.defaultModel ?? state.lastModel;
  if (!chosen) return "Model";
  const known = state.assistant?.models ?? state.models ?? [];
  return known.find((m) => m.id === chosen)?.label ?? chosen.split("/").pop();
};

/**
 * The owner's own menu. Everything a person sets up once lives here, behind the
 * badge that already says who they are, instead of sitting in the rail beside
 * the work.
 */
function openOwnerMenu() {
  const anchor = $("ownerBadge").getBoundingClientRect();
  popMenu(
    { left: anchor.left, bottom: window.innerHeight - anchor.top + 8 },
    [
      ...OWNER_MENU.map((item) => ({ key: item.id, label: item.label, icon: item.id })),
      { key: "disconnect", label: "Disconnect", icon: "exit", danger: true },
    ],
    (key) => (key === "disconnect" ? disconnect() : go(key)),
  );
}

/** Which model answers in this conversation. */
function openModelMenu() {
  const anchor = $("modelPick").getBoundingClientRect();
  const models = state.assistant?.models ?? [];
  const chosen = state.chatModel ?? state.assistant?.chat?.model ?? state.assistant?.defaultModel;
  popMenu(
    { left: anchor.left, top: anchor.bottom + 8 },
    models.map((m) => ({ key: m.id, label: m.label, note: m.note, icon: m.id === chosen ? "check" : null })),
    async (id) => {
      state.chatModel = id;
      rememberModel(id);
      if ($("modelName")) $("modelName").textContent = modelLabel();
      if ($("composerModel")) $("composerModel").textContent = modelLabel();
      if (state.chatId) {
        await api(`assistant/chats/${encodeURIComponent(state.chatId)}`, {
          method: "PATCH",
          body: { model: id },
        });
      }
    },
  );
}

/** One popup, wherever a small list of choices has to appear beside a button. */
function popMenu(at, items, chose) {
  document.querySelector(".pop-bg")?.remove();
  const bg = document.createElement("div");
  bg.className = "pop-bg";
  const box = document.createElement("div");
  box.className = "pop";
  // Kept off the window's own edges: the badge sits flush against the left of
  // the rail, so a menu anchored to it would otherwise touch the frame.
  for (const [side, value] of Object.entries(at)) box.style[side] = `${Math.max(8, value)}px`;
  box.innerHTML = items
    .map(
      (item, index) => `<button class="pop-item ${item.danger ? "danger" : ""}" data-i="${index}">
        <span class="pi">${item.icon ? icon(item.icon, 15) : ""}</span>
        <span class="grow"><b>${h(item.label)}</b>${item.note ? `<small>${h(item.note)}</small>` : ""}</span>
      </button>`,
    )
    .join("");
  bg.appendChild(box);
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.onclick = (event) => event.target === bg && close();
  box.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => {
      close();
      chose(items[Number(b.dataset.i)].key);
    };
  });
}

const shortWorker = () => worker.replace(/^https:\/\//, "").replace(/\.workers\.dev$/, "");

async function checkHealth() {
  if (state.health === null || state.health === "absent") {
    const { ok, data } = await api("system", { quiet: true });
    state.health = ok ? (data.version ?? {}) : "absent";
  }
  const pill = $("healthPill");
  if (!pill) return;
  if (state.health === "absent") {
    pill.className = "pill warn";
    pill.innerHTML = '<span class="d"></span>Deployment is behind';
    return;
  }
  pill.className = "pill";
  pill.innerHTML = `<span class="d"></span>Workers: Active`;
}

async function whoAmI() {
  // Their language too, because the ready made instruction sets are labelled
  // in every language and picking one needs to know which.
  api("locale", { quiet: true }).then(({ ok, data }) => {
    if (ok && data.locale) state.locale = data.locale;
  });
  const { ok, data } = await api("me", { quiet: true });
  if (!ok) return;
  // A deployment that predates this sends neither name, and its "Owner" is a
  // role. The address it is being talked to is in this browser either way, and
  // the account's workers.dev subdomain is inside it, so the name is right on
  // an old deployment as well as a new one.
  const label = data.account || data.subdomain || subdomainOf(worker) || data.label || "Operator";
  if ($("whoName")) $("whoName").textContent = label;
  if ($("whoRole")) $("whoRole").textContent = data.role ?? "signed in";
  if ($("avatar")) $("avatar").innerHTML = pixelAvatar(label);
}

/**
 * A little pixel face, the same one every time for the same owner.
 *
 * Drawn here rather than fetched. Every avatar service works by being sent who
 * the person is — a name, or a hash of their email — and this console is the
 * one place that knows the owner's name at all. Sending it somewhere to get a
 * picture back would put a third party in a path that currently has nobody in
 * it, for decoration.
 *
 * "Random per user" means different between owners, not different between page
 * loads: the drawing is a function of the name, so it is the same on every
 * device and after every reload, and two owners with different names get
 * different faces.
 *
 * Eight rows of eight, mirrored down the middle, which is what makes a grid of
 * noise read as a face.
 */
function pixelAvatar(seed) {
  const hash = fnv1a(String(seed || "?"));
  // One hue for the tile and the pixels, both mid range, so the same drawing
  // works on the light and the dark theme without knowing which it is on.
  const hue = hash % 360;
  const tile = `hsl(${hue} 55% 44%)`;
  const ink = `hsl(${hue} 75% 90%)`;

  const cells = [];
  let bits = hash;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      // A fresh mix per cell, so neighbouring pixels do not fall into stripes.
      bits = (bits ^ (y * 31 + x * 7 + 1)) >>> 0;
      bits = Math.imul(bits, 16_777_619) >>> 0;
      if ((bits >>> 13) % 100 < 46) {
        cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
        cells.push(`<rect x="${7 - x}" y="${y}" width="1" height="1"/>`);
      }
    }
  }
  return `<svg viewBox="0 0 8 8" width="100%" height="100%" shape-rendering="crispEdges"
    role="img" aria-label="Your picture">
      <rect width="8" height="8" fill="${tile}"/>
      <g fill="${ink}">${cells.join("")}</g>
    </svg>`;
}

/** FNV-1a, so the same name gives the same number in every browser. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
}

/**
 * The account's workers.dev handle, out of its own address.
 *
 * `sunrise.nandar.workers.dev` is served from the account whose subdomain is
 * `nandar`. Null on a custom domain, where the hostname says nothing about
 * whose account is behind it.
 */
function subdomainOf(address) {
  let host;
  try {
    host = new URL(address).hostname;
  } catch {
    return null;
  }
  if (!host.endsWith(".workers.dev")) return null;
  const labels = host.slice(0, -".workers.dev".length).split(".");
  return labels.length >= 2 ? labels[labels.length - 1] || null : null;
}

// -------------------------------------------------------------------- router

function go(view, next = {}) {
  clearInterval(state.poll);
  state.poll = null;
  if (view !== state.view) {
    state.page = 1;
    state.filter = "all";
  }
  state.view = view;
  if (next.businessId !== undefined) state.businessId = next.businessId;
  if (next.customerId !== undefined) state.customerId = next.customerId;
  shell();
  render();
}

async function render() {
  const view = $("view");
  if (!view) return;
  view.innerHTML = waitingMark();
  try {
    // Advanced used to be exempt, back when these calls went through a proxy
    // and the Telegram screens were reachable even on a deployment with no data
    // API. They are not any more: a build old enough to lack the API answers
    // the browser's preflight with an error, so nothing on it can be reached
    // from a page at all. Every view reads the one fact.
    if (!(await apiReady())) return viewOutdated();
    if (state.chats === null && state.apiRevision >= NEEDS.assistant) loadChats();
    const needs = NEEDS[state.view] ?? 1;
    if (state.apiRevision < needs) return viewNeedsUpdate(state.view, needs);
    const draw = {
      overview: viewOverview,
      inbox: viewInbox,
      assistant: viewAssistant,
      diagnostics: viewDiagnostics,
      agents: viewAgents,
      businesses: viewBusinesses,
      channels: viewChannels,
      customers: viewCustomers,
      messages: viewMessages,
      settings: viewSettings,
      logs: viewLogs,
      advanced: viewAdvanced,
    }[state.view];
    // Awaited, because the boot screen comes down after this and a view that
    // is still fetching has not drawn anything yet.
    await (draw ?? viewOverview)();
  } finally {
    // Whatever happened. A deployment that cannot be reached is a page saying
    // so, which is a real screen; leaving the mark up over it would be the
    // console pretending it is still trying.
    booted();
  }
}

/** Fill the rail once, from whichever view the console opened on. */
async function loadChats() {
  state.chats = [];
  const { ok, data } = await api("assistant", { quiet: true });
  if (!ok) return;
  state.chats = data.chats ?? [];
  if ($("chatList")) {
    $("chatList").innerHTML = chatRail();
    bindChatRail();
  }
}

async function apiReady() {
  // "ready" is remembered; "absent" is asked again each visit, so the console
  // starts working by itself once the deployment catches up.
  if (state.api !== "ready") {
    // Given a deadline, because the boot screen now waits on this. A Worker
    // that accepts the connection and never answers used to leave a small mark
    // spinning inside a console you could still click out of; it would leave
    // the whole screen covered instead, with nothing to press.
    const { status, data } = await api("system", { quiet: true, signal: AbortSignal.timeout(12000) });
    // A timeout, a refused preflight and an offline deployment are one thing
    // to every caller: no answer.
    state.api = status === 404 || status <= 0 ? "absent" : "ready";
    // A deployment from before this field reports nothing, which is revision 1:
    // the first data API, and everything since then is something it lacks.
    state.apiRevision = Number(data.apiRevision ?? 1) || 1;
  }
  return state.api === "ready";
}

async function overview(force = false) {
  if (state.overview && !force) return state.overview;
  const { data } = await api("overview");
  state.overview = data;
  return data;
}

// ------------------------------------------------------------------ overview

const CHANNEL_ICON = {
  telegram: { icon: "telegram", bg: "var(--blue-soft)", fg: "var(--blue)" },
  web: { icon: "globe", bg: "var(--brand-soft)", fg: "var(--brand-ink)" },
};
const chanTag = (kind) =>
  `<span class="chan"><span class="ic" style="background:${CHANNEL_ICON[kind].bg};color:${CHANNEL_ICON[kind].fg}">
    ${icon(CHANNEL_ICON[kind].icon, 14)}</span>${kind === "telegram" ? "Telegram" : "Website"}</span>`;

function statCard(tile, colour, soft, label, value, delta, spark) {
  return `<div class="card stat">
    <div class="tile" style="background:${soft};color:${colour}">${icon(tile, 18)}</div>
    <div><div class="k">${h(label)}</div><div class="v">${h(value)}</div>${delta ?? ""}</div>
    ${spark ?? ""}</div>`;
}

const deltaLine = (today, yesterday, unit) => {
  if (yesterday === 0 && today === 0) return `<div class="delta">nothing yet</div>`;
  if (yesterday === 0) return `<div class="delta up">▲ first ${h(unit)}</div>`;
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  const dir = pct >= 0 ? "up" : "down";
  return `<div class="delta ${dir}">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs yesterday</div>`;
};

async function viewOverview() {
  const d = await overview();
  const t = d.totals ?? {};
  const series = d.series ?? [];
  const split = d.channels ?? { telegram: 0, web: 0 };
  const totalMsgs = split.telegram + split.web;

  $("view").innerHTML = `
    <div class="page-actions"><button class="btn btn-primary btn-sm" id="newBiz">${icon("plus", 15)}Create agent</button></div>

    <div class="grid g4" style="margin-bottom:16px">
      ${statCard("agents", "var(--brand-ink)", "var(--brand-soft)", "Agents", num(t.agents), `<div class="delta">${
        t.liveChannels > 0 ? "answering now" : "none answering yet"
      }</div>`)}
      ${statCard("channels", "var(--blue)", "var(--blue-soft)", "Live channels", num(t.liveChannels),
        '<div class="delta">Telegram and website</div>')}
      ${statCard(
        "messages", "var(--violet)", "var(--violet-soft)", "Messages today", num(t.messagesToday),
        deltaLine(t.messagesToday ?? 0, t.messagesYesterday ?? 0, "day"),
        // The only card with a line, because messages are the only thing kept
        // per day. A line on the others would have to be drawn from this same
        // series, which would make them say something they do not know.
        sparkline(series.map((p) => p.messages), "var(--violet)"),
      )}
      ${statCard("customers", "var(--green)", "var(--green-soft)", "Customers", num(t.customers),
        '<div class="delta">across every agent</div>')}
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h2>Recent conversations</h2><a href="#" data-goto="messages">View all</a></div>
        <div class="rows">${
          (d.conversations ?? []).length === 0
            ? '<p class="loading">Nobody has written yet.</p>'
            : d.conversations.map(conversationRow).join("")
        }</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Top agents</h2><a href="#" data-goto="agents">View all</a></div>
        ${
          (d.topAgents ?? []).length === 0
            ? '<p class="loading">No agents yet.</p>'
            : `<table><thead><tr><th>Agent</th><th>Messages</th><th>Answered alone</th></tr></thead>
              <tbody>${d.topAgents
                .map(
                  (a) => `<tr class="click" data-business="${h(a.id)}">
                    <td><b>${h(a.name)}</b></td><td>${num(a.messages)}</td>
                    <td>${
                      a.unaided === null
                        ? '<span class="muted" style="color:var(--muted)">no data yet</span>'
                        : `<div style="font-size:12px;margin-bottom:3px">${a.unaided}%</div>
                           <div class="bar"><i style="width:${a.unaided}%"></i></div>`
                    }</td></tr>`,
                )
                .join("")}</tbody></table>`
        }
      </div>
    </div>

    <div class="grid g3">
      <div class="card" style="grid-column:span 1">
        <div class="card-head"><h2>Message volume</h2><span style="font-size:12.5px;color:var(--muted)">Last 7 days</span></div>
        <div class="pad" style="padding-top:12px">
          <div style="font-size:23px;font-weight:720;letter-spacing:-.02em">${num(series.reduce((n, p) => n + p.messages, 0))}</div>
          <div style="color:var(--muted);font-size:12.5px;margin-bottom:8px">messages this week</div>
          ${lineChart(series)}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Channel distribution</h2>
          <span style="font-size:12.5px;color:var(--muted)">All time</span></div>
        <div class="pad" style="display:flex;gap:18px;align-items:center">
          ${donut(
            [
              { value: split.telegram, colour: "var(--blue)" },
              { value: split.web, colour: "var(--brand)" },
            ],
            totalMsgs,
          )}
          <div style="font-size:13px">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:9px">
              <span style="width:9px;height:9px;border-radius:50%;background:var(--blue)"></span>
              <div><b>Telegram</b><div style="color:var(--muted);font-size:12px">${
                totalMsgs === 0 ? "0%" : Math.round((split.telegram / totalMsgs) * 100) + "%"
              } (${num(split.telegram)})</div></div></div>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="width:9px;height:9px;border-radius:50%;background:var(--brand)"></span>
              <div><b>Website</b><div style="color:var(--muted);font-size:12px">${
                totalMsgs === 0 ? "0%" : Math.round((split.web / totalMsgs) * 100) + "%"
              } (${num(split.web)})</div></div></div>
            <p style="color:var(--muted);font-size:12px;margin:14px 0 0;max-width:170px">
              These are the two channels Muxel answers on.</p>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent activity</h2><a href="#" data-goto="logs">View all</a></div>
        <div class="rows" style="padding:8px 0">${
          (d.events ?? []).length === 0
            ? '<p class="loading">Nothing recorded yet.</p>'
            : d.events
                .map(
                  (e) => `<div class="dotline"><span class="d"></span>
                    <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                      <b>${h(e.kind.replace(/_/g, " "))}</b>
                      <span style="color:var(--muted)"> ${h(e.detail)}</span></span>
                    <time>${h(ago(e.createdAt))}</time></div>`,
                )
                .join("")
        }</div>
      </div>
    </div>`;

  $("newBiz").onclick = () => createAgentDialog();
  wireGoto();
  $("view").querySelectorAll("tr[data-business]").forEach(
    (r) => (r.onclick = () => go("agents", { businessId: r.dataset.business, customerId: null })),
  );
  $("view").querySelectorAll("[data-conv]").forEach(
    (r) => (r.onclick = () => go("messages", { customerId: r.dataset.conv })),
  );
}

const STATE_TAG = {
  human: '<span class="tag brand">You are in it</span>',
  waiting: '<span class="tag amber">Waiting</span>',
  settled: '<span class="tag green">Answered</span>',
};

const conversationRow = (c) => `
  <div class="row-item" ${c.customerId ? `data-conv="${h(c.customerId)}" style="cursor:pointer"` : ""}>
    <span class="ic" style="width:30px;height:30px;border-radius:8px;display:grid;place-items:center;flex:none;
      background:${CHANNEL_ICON[c.channel].bg};color:${CHANNEL_ICON[c.channel].fg}">
      ${icon(CHANNEL_ICON[c.channel].icon, 15)}</span>
    <div class="grow"><b>${h(nameOf({ name: c.customerName }))}</b>
      <small>${h(c.businessName)} · ${h(ago(c.updatedAt))}</small></div>
    <span class="say">${h(c.lastMessage)}</span>
    ${STATE_TAG[c.state]}
  </div>`;

function wireGoto() {
  $("view").querySelectorAll("[data-goto]").forEach(
    (a) => (a.onclick = (e) => (e.preventDefault(), go(a.dataset.goto))),
  );
}

/**
 * The conversations a person has been asked to look at.
 *
 * This is the page an operator opens first, so it is a page and not a screen
 * behind two taps. The queue is the handover table, which the assistant writes
 * to when it cannot answer from what it has, and which a takeover clears. It is
 * filtered to the businesses this operator can see, on the deployment's side.
 */
/**
 * The conversations a person has to answer.
 *
 * Its own screen once, and now the Waiting tab on Customers: a queue is a
 * property of the people who are in it, not a separate place. The rows are the
 * same rows either way — this is the one function that draws them, so the two
 * cannot come to disagree about who is waiting.
 */
async function viewInbox() {
  const { data } = await api("inbox");
  const waiting = data.waiting ?? [];
  state.waiting = waiting.filter((item) => item.state === "waiting").length;
  drawNavBadge();
  $("view").innerHTML = waitingTable(waiting);
  wireWaiting();
}

const waitingTable = (waiting) =>
  waiting.length === 0
    ? `<div class="card empty"><h3>Nothing is waiting</h3>
         <p>Your agents are answering everything they are asked. A conversation appears here when one
            of them meets a question it cannot answer from your price list and documents, and when you
            take a chat over yourself.</p></div>`
      : `<div class="card"><table>
          <thead><tr><th>Customer</th><th>Business</th><th>State</th><th>Why</th><th>Waiting since</th></tr></thead>
          <tbody>${waiting
            .map(
              (item) => `<tr class="click" data-customer="${h(item.customerId ?? "")}">
                <td><b>${h(item.customerName || "Someone")}</b></td>
                <td>${h(item.businessName)}</td>
                <td>${
                  item.state === "human"
                    ? '<span class="tag brand">You are in it</span>'
                    : '<span class="tag amber">Waiting</span>'
                }</td>
                <td style="color:var(--muted)">${h(item.reason || "no reason recorded")}</td>
                <td style="color:var(--muted)">${h(ago(item.openedAt))}</td></tr>`,
            )
            .join("")}</tbody></table>
          <div class="tfoot"><span>${waiting.length} conversation${waiting.length === 1 ? "" : "s"} open</span>
            <span>Taking one over clears it from here.</span></div></div>`;

function wireWaiting() {
  $("view").querySelectorAll("tr[data-customer]").forEach((r) => {
    if (r.dataset.customer === "") return;
    r.onclick = () => go("messages", { customerId: r.dataset.customer });
  });
}

/** Redraws just the count, so a badge cannot cost a whole shell rebuild. */
function drawNavBadge() {
  const item = document.querySelector('.nav-item[data-view="customers"]');
  if (!item) return;
  item.querySelector(".badge")?.remove();
  if (state.waiting > 0) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = String(state.waiting);
    item.appendChild(badge);
  }
}

/**
 * What this deployment can and cannot do, as facts rather than a log.
 *
 * The bot's version of this screen prints the last ten events and lets the
 * reader work it out. A page can say the thing directly: what configuration is
 * missing, whether the schema is current, which bots exist, and only the events
 * that were failures.
 */
async function viewDiagnostics() {
  const { data } = await api("diagnostics");
  const missing = data.missing ?? [];
  const schema = data.schema ?? {};
  const ok = missing.length === 0 && schema.current && (data.origin ?? "") !== "";

  $("view").innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Configuration</h2>
        ${ok ? '<span class="tag green">All set</span>' : '<span class="tag amber">Needs attention</span>'}</div>
      <table><tbody>
        <tr><td style="width:280px">Required settings</td>
          <td>${
            missing.length === 0
              ? '<span class="tag green">Complete</span>'
              : `<span class="tag amber">Missing</span> <span style="color:var(--muted)">${missing
                  .map((key) => h(key))
                  .join(", ")}</span>`
          }</td></tr>
        <tr><td>Database schema</td>
          <td>${
            schema.current
              ? `<span class="tag green">Current</span> <span style="color:var(--muted)">version ${h(schema.at)}</span>`
              : `<span class="tag amber">Behind</span> <span style="color:var(--muted)">at ${h(schema.at)}, this build wants ${h(schema.target)}. It applies itself on the next request.</span>`
          }</td></tr>
        <tr><td>Address it tells Telegram</td>
          <td>${
            (data.origin ?? "") === ""
              ? '<span class="tag amber">Not recorded yet</span> <span style="color:var(--muted)">nothing has reached this deployment on its public address</span>'
              : `<code>${h(data.origin)}</code>`
          }</td></tr>
        <tr><td>Console bot</td>
          <td>${
            data.consoleBot
              ? `<code>@${h(data.consoleBot)}</code>`
              : '<span class="tag amber">None</span>'
          }</td></tr>
      </tbody></table>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Bots</h2></div>
      ${
        (data.bots ?? []).length === 0
          ? '<p class="loading">No businesses yet, so there are no bots to check.</p>'
          : `<table><thead><tr><th>Business</th><th>Bot</th><th>Role</th><th>State</th></tr></thead>
             <tbody>${data.bots
               .flatMap((row) =>
                 row.bots.length === 0
                   ? [`<tr><td>${h(row.business)}</td><td colspan="3" style="color:var(--muted)">website only</td></tr>`]
                   : row.bots.map(
                       (bot) => `<tr><td>${h(row.business)}</td><td><code>@${h(bot.username)}</code></td>
                         <td style="color:var(--muted)">${bot.role === "reply" ? "answers customers" : "admin"}</td>
                         <td>${bot.enabled ? '<span class="tag green">On</span>' : '<span class="tag grey"><span class="d"></span>Off</span>'}</td></tr>`,
                     ),
               )
               .join("")}</tbody></table>`
      }
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Recent failures</h2>
        <a href="#" data-goto="logs">All events</a></div>
      ${
        (data.failures ?? []).length === 0
          ? '<p class="loading">Nothing has failed recently.</p>'
          : `<table><tbody>${data.failures
              .map(
                (event) => `<tr><td style="width:130px;color:var(--muted)">${h(ago(event.createdAt))}</td>
                  <td style="width:180px">${h(event.businessName ?? "—")}</td>
                  <td><span class="tag">${h(event.kind.replace(/_/g, " "))}</span></td>
                  <td style="color:var(--muted)">${h(event.detail)}</td></tr>`,
              )
              .join("")}</tbody></table>`
      }
    </div>

    <div class="card">
      <div class="card-head"><h2>The bot's own screens</h2></div>
      <div class="pad" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <p style="margin:0;color:var(--muted);font-size:13.5px;flex:1;min-width:300px">Everything this console
          does, it does by asking your deployment the same questions the Telegram console bot asks. If a page
          here has not done what you needed, the bot's own screens are the fallback, and a screen it grows
          tomorrow appears there before it has a page here.</p>
        <button class="btn btn-ghost btn-sm" id="openAdvanced">Open them</button>
      </div>
    </div>`;
  wireGoto();
  $("openAdvanced").onclick = () => go("advanced");
}

const APPROVAL_TAG = {
  waiting: '<span class="tag amber">Waiting for you</span>',
  approved: '<span class="tag green">Done</span>',
  declined: '<span class="tag grey"><span class="d"></span>Declined</span>',
  failed: '<span class="tag amber">Failed</span>',
};

/**
 * The owner talking to their own deployment.
 *
 * It reads anything and changes nothing on its own. A change arrives as a card
 * saying exactly what would happen, and it does not happen until the button is
 * pressed. That is enforced in the deployment, not here: this page draws what
 * it is told and cannot approve anything by accident.
 */
async function viewAssistant() {
  const path = state.chatId === null ? "assistant" : `assistant?chat=${encodeURIComponent(state.chatId)}`;
  const { ok, data } = await api(path);
  if (!ok) return;
  // A blank chat is a real state: the owner pressed New chat and has not said
  // anything yet. Their latest conversation's messages are not this one's, so
  // the transcript is emptied rather than borrowed.
  state.assistant = state.newChat ? { ...data, chat: null, messages: [], steps: {} } : data;
  state.chats = data.chats ?? [];
  if (!state.newChat) state.chatId = data.chat?.id ?? null;
  state.chatModel = state.newChat
    ? (data.defaultModel ?? null)
    : (data.chat?.model ?? data.defaultModel ?? null);
  if (data.models?.length) state.models = data.models;
  rememberModel(state.chatModel);
  if ($("chatList")) {
    $("chatList").innerHTML = chatRail();
    bindChatRail();
  }
  if ($("modelName")) $("modelName").textContent = modelLabel();
  drawAssistant();
}

/* ------------------------------------------------------------------ markdown

   A model writes markdown whether or not anyone renders it, so the choice is
   between showing a heading and showing a hash. Written here rather than pulled
   in, because the console is four files a browser fetches directly and a
   markdown library is larger than all of them.

   Everything is escaped before a single tag is added, and the only tags that
   come back are the ones this file writes. A link has to be http or https to
   survive, which is what stops `javascript:` from arriving inside one.
*/

const SAFE_LINK = /^https?:\/\//i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|txt|zip|pptx?|json|md)(\?|#|$)/i;

/** The last path segment, which is the only part of a URL worth a filename. */
function fileNameOf(url) {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) || url;
  } catch {
    return url;
  }
}

const linkHtml = (url, text) => {
  if (!SAFE_LINK.test(url)) return h(text);
  if (IMAGE_EXT.test(url)) return imageHtml(url, text);
  if (FILE_EXT.test(url)) {
    return `<a class="file-chip" href="${h(url)}" target="_blank" rel="noopener noreferrer">
      ${icon("doc", 15)}<span>${h(text && text !== url ? text : fileNameOf(url))}</span></a>`;
  }
  return `<a href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(text || url)}</a>`;
};

/**
 * A picture, or the honest fallback when there is no picture.
 *
 * A model can name an image that has moved or never existed. Left alone the
 * browser draws its own broken glyph inside a frame this file added, which
 * looks like the console failed rather than like the link did.
 */
const imageHtml = (url, alt) =>
  SAFE_LINK.test(url)
    ? `<a class="md-shot" href="${h(url)}" target="_blank" rel="noopener noreferrer"
          data-name="${h(alt || fileNameOf(url))}">
         <img src="${h(url)}" alt="${h(alt || "")}" loading="lazy" data-shot></a>`
    : h(alt || url);

/** Inline formatting, applied to text that is already escaped. */
function inline(escaped) {
  return (
    escaped
      // Code first: nothing inside a span of code is formatting.
      .replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => imageHtml(unescapeAttr(url), alt))
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => linkHtml(unescapeAttr(url), text))
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      // A URL nobody wrote a link for is still a link the reader wants.
      .replace(
        /(^|[\s>])(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g,
        (_, before, url) => `${before}${linkHtml(unescapeAttr(url), url)}`,
      )
  );
}

/** `h()` ran first, so a URL captured out of it arrives with its entities. */
const unescapeAttr = (url) =>
  url.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

const CELLS = (row) =>
  row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());

/** Renders one message body. Returns HTML built only from this file's tags. */
function md(text) {
  const lines = h(text ?? "").split("\n");
  const out = [];
  let list = null;
  const closeList = () => {
    if (list !== null) out.push(`</${list}>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Fenced code, kept exactly as written and never formatted.
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      closeList();
      const body = [];
      for (i += 1; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i += 1) body.push(lines[i]);
      out.push(`<div class="md-code"><div class="md-code-head"><span>${
        h(fence[1] || "code")
      }</span><button class="t-act" data-code>${icon("copy", 13)}Copy</button></div><pre>${body.join(
        "\n",
      )}</pre></div>`);
      continue;
    }

    // A table is a run of rows, so it is taken whole rather than line by line.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      closeList();
      const head = CELLS(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i += 1) rows.push(CELLS(lines[i]));
      i -= 1;
      out.push(`<div class="md-table"><table><thead><tr>${head
        .map((cell) => `<th>${inline(cell)}</th>`)
        .join("")}</tr></thead><tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`);
      continue;
    }

    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length + 2);
      out.push(`<h${level} class="md-h">${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      closeList();
      out.push('<hr class="md-hr">');
      continue;
    }

    const quote = /^\s*&gt;\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const want = bullet ? "ul" : "ol";
      if (list !== want) {
        closeList();
        out.push(`<${want} class="md-list">`);
        list = want;
      }
      out.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
      continue;
    }

    if (line.trim() === "") {
      closeList();
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

/** Turns an image that failed into the link it always was. */
function wireImages(root) {
  root.querySelectorAll("[data-shot]").forEach((img) => {
    img.onerror = () => {
      const frame = img.closest(".md-shot");
      if (frame === null || frame.classList.contains("broken")) return;
      frame.classList.add("broken");
      frame.insertAdjacentHTML("afterbegin", `${icon("doc", 15)}<span>${h(frame.dataset.name)}</span>`);
    };
  });
}

/** Wires the copy button on every code block currently on screen. */
function wireCodeBlocks(root) {
  root.querySelectorAll("[data-code]").forEach((b) => {
    b.onclick = async () => {
      const code = b.closest(".md-code").querySelector("pre").textContent;
      await navigator.clipboard?.writeText(code).catch(() => undefined);
      b.innerHTML = `${icon("check", 13)}Copied`;
      setTimeout(() => (b.innerHTML = `${icon("copy", 13)}Copy`), 1600);
    };
  });
}

const GREETINGS = [
  "What can I do for you?",
  "Ask me anything about your businesses.",
];

const OPENERS = [
  "What is waiting for me?",
  "Which agent answered the most today?",
  "What did customers ask that we could not answer?",
  "Add a rule: no deliveries on Sunday",
];

/**
 * The conversation.
 *
 * The owner's turn is a bubble, because it is a thing they said and it wants an
 * edge. The assistant's turn is not: it is the page's own content, so it sits
 * on the page in full width, under a line saying who is speaking and which
 * model answered, with its working above it and its actions below.
 */
function drawAssistant() {
  const { messages = [], approvals = [], steps = {}, usage = {}, prompts = {} } = state.assistant ?? {};
  const blank = messages.length === 0;
  // Typing "yes" runs nothing; the button on the card does. So a waiting change
  // is said once above the box the owner is about to type into, with a way to
  // get back to it, because the card that raised it may be far up the thread.
  const waiting = approvals.filter((a) => a.state === "waiting");
  const cardsFor = (messageId) => approvals.filter((a) => a.messageId === messageId);

  $("view").innerHTML = `
    <div class="chat-page ${blank ? "blank" : ""}">
      <div class="thread" id="asThread">${
        blank
          ? `<div class="greet">
               <img src="/assets/logo.png" alt="">
               <h2>${h(GREETINGS[0])}</h2>
               <p>I can read your businesses, your price lists, and everything your agents were asked.
                  I can propose changes too, and every one of those waits for your yes.</p>
             </div>`
          : messages
              .map((m, i) =>
                turnHtml(m, steps[m.id] ?? [], cardsFor(m.id), usage[m.id], {
                  prompt: prompts[m.id],
                  // Only the last turn is still waiting on anything. An older
                  // question was answered by whatever was said after it.
                  open: i === messages.length - 1,
                }),
              )
              .join("")
      }</div>

      <form class="composer-wrap" id="asSay">
        ${
          waiting.length === 0
            ? ""
            : `<button type="button" class="waiting-bar" id="toWaiting">
                 ${icon("bell", 14)}${waiting.length} change${waiting.length === 1 ? "" : "s"}
                 waiting for you — tap Yes on the card</button>`
        }
        <div class="composer">
          <textarea id="asText" rows="1" placeholder="Ask about your businesses, or tell it what to change"
            autocomplete="off"></textarea>
          <div class="composer-row">
            <span class="composer-model" id="composerModel">${h(modelLabel())}</span>
            <span class="grow"></span>
            <button class="send" type="submit" id="asSend" title="Send">${icon("up", 17)}</button>
            <button class="send stop" type="button" id="asStop" title="Stop" hidden>${icon("stop", 15)}</button>
          </div>
        </div>
        ${blank ? `<div class="openers">${OPENERS.map((q) => `<button type="button" class="opener" data-ask="${h(q)}">${h(q)}</button>`).join("")}</div>` : ""}
      </form>
    </div>`;

  const thread = $("asThread");
  thread.scrollTop = thread.scrollHeight;
  $("asSay").onsubmit = sendToAssistant;
  growBox($("asText"));
  $("asText").focus();
  $("composerModel").onclick = () => $("modelPick")?.click();
  if ($("toWaiting")) {
    $("toWaiting").onclick = () =>
      $("view").querySelector(".approval.waiting")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  bindTurnActions();
  wireCodeBlocks($("view"));
  wireImages($("view"));
  $("view").querySelectorAll("[data-ask]").forEach((b) => {
    b.onclick = () => {
      $("asText").value = b.dataset.ask;
      sendToAssistant(new Event("submit"));
    };
  });
}

/** One turn: who said it, what they said, and what it led to. */
function turnHtml(message, steps, cards, usage, waiting = {}) {
  // Both sides are rendered, not just the model's. An owner who pastes a link
  // or a table has written the same markup, and showing them the asterisks
  // while formatting the reply would be an odd thing to explain.
  if (message.role === "user") {
    return `<div class="turn user"><div class="ubub">${md(message.content)}</div></div>`;
  }
  return `<div class="turn ai" data-msg="${h(message.id)}">
      ${steps.length > 0 ? `<div class="steps">${steps.map(stepLine).join("")}</div>` : ""}
      <div class="ai-head">
        <img class="ai-av" src="/assets/logo.png" alt="">
        <b>${h(usage?.label ?? modelLabel())}</b>
        <span class="when">${h(ago(message.createdAt))}</span>
      </div>
      <div class="ai-body">${md(message.content)}</div>
      ${cards.length > 0 ? approvalCard(cards) : ""}
      ${waiting.open && waiting.prompt ? promptCard(waiting.prompt) : ""}
      <div class="ai-acts">
        <button class="t-act" data-copy="${h(message.id)}" title="Copy">${icon("copy", 14)}Copy</button>
        <button class="t-act" data-retry="1" title="Ask again">${icon("retry", 14)}Retry</button>
        ${costLine(usage)}
      </div>
    </div>`;
}

/**
 * What this answer drew from the day's allowance.
 *
 * Three numbers, and every one of them measured: the tokens are the model's own
 * count, and the neurons are those tokens at the rate this account actually
 * paid for that model today. When the rate is not known — no API token, or the
 * first reply of the day, before Cloudflare has reported anything — the tokens
 * are shown alone rather than a neuron figure nobody can stand behind.
 */
function costLine(usage) {
  if (!usage) return "";
  const tokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  const { neuronsToday, perDay, problem } = state.assistant?.allowance ?? {};
  const parts = [];
  parts.push(
    usage.neurons === null || usage.neurons === undefined
      ? `cost ${num(tokens)} tokens`
      : `cost ${num(usage.neurons)}`,
  );
  if (typeof neuronsToday === "number" && typeof perDay === "number") {
    parts.push(`remaining ${num(Math.max(0, perDay - neuronsToday))}`);
    parts.push(`total ${num(perDay)}`);
  }
  const why =
    problem === "not_configured"
      ? "Add a Cloudflare read token in Settings to see your neuron allowance"
      : problem === "unreachable"
        ? "Cloudflare did not answer for the neuron figures"
        : "";
  return `<span class="cost" ${why ? `title="${h(why)}"` : ""}>${h(parts.join(" · "))}${
    why ? " ·<span class=\"cost-why\">?</span>" : ""
  }</span>`;
}

/**
 * A tool it ran, in words.
 *
 * Read off the record of what actually ran; a tool with no line here did not
 * run, and there is no line for a tool that did not.
 */
const STEP_WORDS = {
  list_businesses: "Looked at your businesses",
  get_business: "Read a business",
  search_knowledge: "Searched what the agent knows",
  list_waiting: "Checked what is waiting",
  list_customers: "Looked at your customers",
  read_conversation: "Read a conversation",
  set_model: "Proposed a model change",
  set_persona: "Proposed a persona change",
  save_rule: "Proposed a rule",
  delete_rule: "Proposed removing a rule",
  save_note: "Proposed a note",
  delete_note: "Proposed removing a note",
  save_profile: "Proposed a profile change",
  save_price: "Proposed a price",
  remove_price: "Proposed removing a price",
  set_features: "Proposed a feature change",
  ask_owner: "Asked you a question",
  connect_telegram: "Opened the Telegram field",
  create_business: "Proposed a new business",
  delete_business: "Proposed deleting a business",
};

const stepLine = (step) =>
  `<div class="step ${step.ok ? "" : "bad"}">${icon(step.ok ? "check" : "retry", 13)}
     ${h(STEP_WORDS[step.tool] ?? step.tool)}</div>`;

function bindTurnActions() {
  $("view").querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = async () => {
      const body = b.closest(".turn").querySelector(".ai-body").textContent;
      await navigator.clipboard?.writeText(body).catch(() => undefined);
      b.innerHTML = `${icon("check", 14)}Copied`;
      setTimeout(() => (b.innerHTML = `${icon("copy", 14)}Copy`), 1600);
    };
  });
  $("view").querySelectorAll("[data-retry]").forEach((b) => {
    b.onclick = () => {
      const asked = b.closest(".turn").previousElementSibling?.querySelector(".ubub")?.textContent;
      if (!asked) return;
      $("asText").value = asked;
      growBox($("asText"));
      $("asText").focus();
    };
  });
  $("view").querySelectorAll("[data-approve]").forEach((b) => {
    b.onclick = () => answerApproval(b.dataset.approve, b.dataset.yes === "1");
  });
  // Tapping an offered answer says it, which is what typing it would have done.
  $("view").querySelectorAll("[data-answer]").forEach((b) => {
    b.onclick = () => {
      $("asText").value = b.dataset.answer;
      sendToAssistant(new Event("submit"));
    };
  });
  if ($("botTokSave")) $("botTokSave").onclick = connectTelegramFromChat;
  if ($("allYes")) $("allYes").onclick = approveAll;
}

/**
 * Paints the change cards again from the record, without rebuilding the thread.
 *
 * A full redraw would do it, but it also scrolls the thread and takes the
 * cursor back, which is the wrong thing to do five times in a row while a run
 * is going. Every surface touched here reads the same list: the rows, the
 * header's count, and the bar above the composer. None of them is told what
 * happened — they are re-read off state.assistant.approvals, so a row is green
 * exactly when the deployment says it is.
 */
function paintChanges() {
  const approvals = state.assistant?.approvals ?? [];
  $("view")
    .querySelectorAll(".turn.ai[data-msg]")
    .forEach((turn) => {
      const card = turn.querySelector(".changes");
      if (!card) return;
      const mine = approvals.filter((a) => a.messageId === turn.dataset.msg);
      if (mine.length > 0) card.outerHTML = approvalCard(mine);
    });

  const left = approvals.filter((a) => a.state === "waiting").length;
  const bar = $("toWaiting");
  if (bar && left === 0) bar.remove();
  else if (bar) {
    bar.innerHTML = `${icon("bell", 14)}${left} change${left === 1 ? "" : "s"}
                 waiting for you — tap Yes on the card`;
  }
  bindTurnActions();
}

/**
 * Says yes to every change still waiting in this conversation.
 *
 * Asked first, and told how many. One tap running twenty five changes is the
 * point of the button, and also the reason a mis-tap would be expensive.
 *
 * The card fills in as it goes. Each row turns green the round it lands, and
 * the button counts what is left, because twenty five writes take long enough
 * that a card sitting there silent until the last one reads as a button that
 * did nothing — and a five second stare at an unchanged card is the same bug
 * at a smaller size. The counter alone was not enough: it is one line of small
 * text, and the rows are the thing being looked at.
 *
 * And it reports what happened: every change that could not be made is counted
 * and the first reason is said out loud, rather than the whole run ending in
 * "Done." whatever came back.
 */
async function approveAll() {
  const waiting = (state.assistant?.approvals ?? []).filter((a) => a.state === "waiting");
  if (waiting.length === 0) return;
  const choice = await ask(
    `Say yes to ${waiting.length} changes`,
    "They are made one after another, in the order they were proposed. Anything that fails is left alone and reported.",
    [{ key: "yes", label: `Do all ${waiting.length}`, primary: true }],
  );
  if (!choice) return;

  let last;
  let made = 0;
  const refused = [];
  for (const [index, approval] of waiting.entries()) {
    // Re-read every time, because the card is painted again between rounds.
    // Nothing in it is tappable while the run is going: a row about to be run
    // still has its Yes, and a second tap on it would be a second write.
    const button = $("allYes");
    if (button) {
      button.disabled = true;
      button.textContent = `${index + 1} of ${waiting.length}…`;
    }
    $("view").querySelectorAll("[data-approve]").forEach((b) => (b.disabled = true));
    const { ok, data } = await api(`assistant/approvals/${approval.id}`, {
      method: "POST",
      body: { yes: true },
    });
    // Two different `ok`s meet here. The outer one is whether the deployment
    // answered at all; `data.ok` is whether the change was actually made. A
    // change that failed comes back as a perfectly good HTTP 200.
    if (!ok) {
      refused.push("Your deployment did not answer.");
      break;
    }
    last = data;
    if (data.ok === false) refused.push(data.message || approval.summary);
    else made += 1;
    // Green the moment it is green. The rows are a view of the record, so the
    // record arriving is the whole update — and the run reads as a list
    // filling in rather than as a card that sat still and then jumped.
    if (data.approvals) {
      state.assistant = { ...state.assistant, approvals: data.approvals };
      paintChanges();
    }
  }

  if (last) state.assistant = { ...state.assistant, approvals: last.approvals };
  state.overview = null;
  toast(
    refused.length === 0
      ? `Done. ${made} made.`
      : `${made} made, ${refused.length} not: ${refused[0]}`,
  );
  drawAssistant();
}

/**
 * The token goes from this page to the owner's own deployment.
 *
 * Not through the conversation, and so not into the transcript the deployment
 * reads back to itself on every later turn. The assistant is told it worked or
 * did not, and never what the token was.
 */
async function connectTelegramFromChat() {
  const field = $("botTok");
  const businessId = field.closest("[data-token]").dataset.token;
  const value = field.value.trim();
  if (!value) return;
  $("botTokSave").disabled = true;
  const { ok, data } = await api(`businesses/${encodeURIComponent(businessId)}/telegram`, {
    method: "POST",
    body: { token: value },
  });
  $("botTokSave").disabled = false;
  field.value = "";
  if (!ok) return toast("Telegram would not accept that token.");
  $("asText").value = `Connected. The bot is @${data.telegram?.username ?? ""}.`;
  sendToAssistant(new Event("submit"));
}

/** The box grows with what is typed, and Enter sends unless Shift is held. */
function growBox(box) {
  const fit = () => {
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 220)}px`;
  };
  box.oninput = fit;
  box.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendToAssistant(new Event("submit"));
    }
  };
  fit();
}

/**
 * What the turn is waiting on the owner for.
 *
 * A question with the answers it offered, or the one field a token may be
 * typed into. Drawn only under the last turn: an older question was answered
 * by whatever came after it, and offering its buttons again would restart a
 * conversation the owner has already moved past.
 */
function promptCard(prompt) {
  if (prompt.kind === "telegram_token") {
    return `<div class="prompt" data-token="${h(prompt.businessId)}">
        <b>Your Telegram bot's token</b>
        <p>From @BotFather. It goes from this page straight to your own deployment — it is not part of
           the conversation and the model never sees it.</p>
        <div class="prompt-row">
          <input type="password" id="botTok" placeholder="123456:ABC-DEF…" autocomplete="off">
          <button class="btn btn-primary btn-sm" id="botTokSave">Connect</button>
        </div>
      </div>`;
  }
  if (prompt.kind !== "question" || !prompt.choices?.length) return "";
  return `<div class="prompt choices">${prompt.choices
    .map((choice) => `<button class="opener" data-answer="${h(choice)}">${h(choice)}</button>`)
    .join("")}</div>`;
}

/** One proposed change, and the two buttons that decide it. */
/**
 * Every change one answer proposed, in one card.
 *
 * They used to be a card each, so a turn that proposed a business and ten
 * prices produced eleven boxes down the thread and the owner had to hunt for
 * the end of them. It is one card now: a row per change with a switch, the
 * count in the header, and one control that says yes to all of them.
 *
 * A switch acts when it is flipped. There is no separate save, because a list
 * of unsaved intentions is a second state to keep and a second thing to explain
 * — and the row already says what it will do.
 */
function approvalCard(approvals) {
  const waiting = approvals.filter((a) => a.state === "waiting");
  return `<div class="changes">
      <div class="changes-head">
        <b>${
          waiting.length > 0
            ? `${waiting.length} change${waiting.length === 1 ? "" : "s"} waiting for you`
            : `${approvals.length} change${approvals.length === 1 ? "" : "s"}`
        }</b>
        ${
          waiting.length > 1
            ? `<button class="btn btn-primary btn-sm" id="allYes">Yes to all</button>`
            : ""
        }
      </div>
      ${approvals.map(changeRow).join("")}
    </div>`;
}

/** One proposed change: what it is, what it would do, and the switch. */
const changeRow = (a) => `
  <div class="change ${a.state}">
    <div class="change-what">
      <b>${h(a.summary)}</b>
      <small>${h(a.tool)}${
        Object.keys(a.args).length === 0
          ? ""
          : ` · ${h(
              Object.entries(a.args)
                .filter(([key]) => key !== "business_id")
                .map(([key, value]) => `${key}: ${String(value).slice(0, 60)}`)
                .join(" · "),
            )}`
      }${a.result ? ` · ${h(a.result)}` : ""}</small>
    </div>
    ${
      a.state === "waiting"
        ? `<div class="switch" role="group" aria-label="${h(a.summary)}">
             <button data-approve="${h(a.id)}" data-yes="0">No</button>
             <button data-approve="${h(a.id)}" data-yes="1">Yes</button>
           </div>`
        : APPROVAL_TAG[a.state] ?? ""
    }
  </div>`;

async function sendToAssistant(event) {
  event.preventDefault?.();
  const input = $("asText");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.style.height = "auto";
  input.disabled = true;
  // The arrow becomes a stop square for as long as the turn is running, so the
  // one control in reach is the one that does something.
  state.pending = new AbortController();
  state.stopped = false;
  $("asSend").hidden = true;
  $("asStop").hidden = false;
  $("asStop").onclick = () => {
    // Stops the typing as well as the request; otherwise the words keep
    // appearing after the owner has said to stop.
    state.stopped = true;
    state.pending?.abort();
  };

  // The turn appears the moment it is sent, with a line saying it is working,
  // because a tool loop takes several seconds and a still screen reads as a
  // failure. Neither is a claim about what it found; both are replaced by the
  // record when the answer comes back.
  const page = $("view").querySelector(".chat-page");
  page?.classList.remove("blank");
  $("view").querySelector(".greet")?.remove();
  $("view").querySelector(".openers")?.remove();
  const thread = $("asThread");
  thread.insertAdjacentHTML(
    "beforeend",
    `<div class="turn user"><div class="ubub">${md(text)}</div></div>
     <div class="turn ai" id="asThinking">
       <div class="steps"></div>
       <div class="ai-head"><img class="ai-av" src="/assets/logo.png" alt="">
         <b>${h(modelLabel())}</b>
         <span class="work-label">Thinking</span></div>
       <div class="ai-body thinking"><span></span><span></span><span></span></div>
     </div>`,
  );
  thread.scrollTop = thread.scrollHeight;

  const { ok, data, aborted } = await askAssistant(
    { text, chatId: state.chatId ?? undefined, model: state.chatModel ?? undefined },
    state.pending.signal,
  );
  state.pending = null;
  input.disabled = false;
  if ($("asSend")) {
    $("asSend").hidden = false;
    $("asStop").hidden = true;
  }
  if (aborted) {
    // Stopping ends the waiting, not the work: the deployment finishes the turn
    // and writes the answer down. So the chat is read back rather than left
    // showing a question with nothing under it.
    return viewAssistant();
  }
  if (!ok) {
    $("asThinking")?.remove();
    input.value = text;
    growBox(input);
    return;
  }
  state.assistant = data;
  state.chats = data.chats ?? [];
  state.chatId = data.chat?.id ?? state.chatId;
  if (data.models?.length) state.models = data.models;
  state.newChat = false;
  if ($("chatList")) {
    $("chatList").innerHTML = chatRail();
    bindChatRail();
  }
  drawAssistant();
}

/**
 * Asks, and shows the answer arriving.
 *
 * The deployment writes events down the response as it works, so what appears
 * on screen is what is happening: the tool it is running now, and the answer
 * as it comes. The last event carries the same payload the plain JSON call
 * returns, so the screen it settles into is drawn from one shape either way.
 *
 * A deployment too old to stream answers with JSON, which parses here as one
 * "done" and skips straight to the finished screen.
 */
async function askAssistant(body, signal) {
  let response;
  try {
    response = await fetch(`${worker}/admin/api/assistant`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, aborted: true, data: {} };
    return { ok: false, data: {} };
  }
  if (!response.ok) return { ok: false, data: {} };

  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return { ok: true, data: await response.json().catch(() => ({})) };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = null;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      // SSE frames are separated by a blank line, and a chunk can end mid
      // frame, so the tail is kept until its blank line arrives.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (line === undefined) continue;
        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (event.type === "done") done = event;
        else if (event.type === "failed") return { ok: false, data: {} };
        else showProgress(event);
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, aborted: true, data: {} };
    return { ok: false, data: {} };
  }
  if (done === null) return { ok: false, data: {} };
  // The words are typed out before the finished screen replaces them, so the
  // answer appears the way it was written rather than all at once.
  await typeOut(done.text ?? "");
  return { ok: true, data: done };
}

/** What the deployment says it is doing, drawn into the waiting turn. */
function showProgress(event) {
  const turn = $("asThinking");
  if (turn === null) return;
  if (event.type === "status") {
    const label = turn.querySelector(".work-label");
    if (label) label.textContent = event.label;
    return;
  }
  if (event.type === "step") {
    const steps = turn.querySelector(".steps");
    if (steps) steps.insertAdjacentHTML("beforeend", stepLine(event));
    scrollThread();
  }
}

/** How fast the answer appears. Fast enough to read along with, not to wait on. */
const TYPE_MS_PER_CHAR = 6;

/**
 * Reveals the answer.
 *
 * The text is not rewritten on its way here and nothing is held back: this
 * paints what arrived, in order, at a readable rate, and stops the moment the
 * owner presses the stop square.
 */
async function typeOut(text) {
  const turn = $("asThinking");
  if (turn === null || text.length === 0) return;
  const body = turn.querySelector(".ai-body");
  body.classList.remove("thinking");
  const label = turn.querySelector(".work-label");
  if (label) label.remove();
  const at = performance.now();
  for (let cut = 0; cut <= text.length; cut += Math.max(1, Math.ceil(text.length / 220))) {
    if (state.stopped) break;
    body.innerHTML = md(text.slice(0, cut));
    scrollThread();
    await new Promise((r) => setTimeout(r, TYPE_MS_PER_CHAR));
    // A very long answer would otherwise hold the screen for a minute.
    if (performance.now() - at > 6000) break;
  }
  body.innerHTML = md(text);
  scrollThread();
}

/** Kept in this browser only, so the name is right before any call returns. */
function rememberModel(id) {
  if (!id) return;
  state.lastModel = id;
  try {
    localStorage.setItem("muxel.model", id);
  } catch {
    // A browser refusing storage is not a reason to fail a chat.
  }
}

function scrollThread() {
  const thread = $("asThread");
  if (thread) thread.scrollTop = thread.scrollHeight;
}

async function answerApproval(approvalId, yes) {
  $("view").querySelectorAll("[data-approve]").forEach((b) => (b.disabled = true));
  const { ok, data } = await api(`assistant/approvals/${approvalId}`, {
    method: "POST",
    body: { yes },
  });
  // `ok` is whether the deployment answered; `data.ok` is whether the change
  // was made. A change that could not be made answers perfectly well.
  if (!ok) {
    toast("Your deployment did not answer.");
    return drawAssistant();
  }
  if (data.approvals) state.assistant = { ...state.assistant, approvals: data.approvals };
  state.overview = null;
  toast(data.message ?? (yes ? "Done." : "Left as it was."));
  drawAssistant();
}

// -------------------------------------------------------------------- agents

async function viewAgents() {
  if (state.businessId) return agentConfig();
  const { data } = await api("agents");
  const all = data.agents ?? [];
  // Where a web agent answers, built from what the deployment reported about
  // itself. Empty on a deployment that predates the field, in which case the
  // column simply is not offered rather than pointing somewhere wrong.
  const tryUrl = (agent) =>
    data.origin && agent.web?.enabled && agent.web?.key
      ? `${String(data.origin).replace(/\/+$/, "")}/w/${agent.web.key}`
      : "";
  const shown = all.filter((a) => (state.filter === "all" ? true : state.filter === "live" ? a.live : !a.live));

  $("view").innerHTML = `
    <div class="page-actions"><button class="btn btn-primary btn-sm" id="newBiz">${icon("plus", 15)}Create agent</button></div>
    <div class="tabs">
      <button data-filter="all" class="${state.filter === "all" ? "on" : ""}">All agents<span class="n">${all.length}</span></button>
      <button data-filter="live" class="${state.filter === "live" ? "on" : ""}">Live<span class="n">${all.filter((a) => a.live).length}</span></button>
      <button data-filter="off" class="${state.filter === "off" ? "on" : ""}">Off<span class="n">${all.filter((a) => !a.live).length}</span></button>
    </div>
    ${
      all.length === 0
        ? `<div class="card empty"><h3>No agents yet</h3>
             <p>An agent is one of your businesses answering somewhere: on Telegram, or in a chat bubble on
                your own site. Pick a business and choose where, and it starts answering.</p>
             <button class="btn btn-primary" id="newBiz2">Set up your first agent</button></div>`
        : `<div class="card"><table>
            <thead><tr><th>Agent</th><th>Status</th><th>Channels</th><th>Messages today</th>
              <th>Answered alone</th><th>Last activity</th><th>Try it</th></tr></thead>
            <tbody>${shown
              .map(
                (a) => `<tr class="click" data-business="${h(a.id)}">
                  <td><b>${h(a.name)}</b><div style="color:var(--muted);font-size:12px">${h(a.modelLabel)}</div></td>
                  <td>${a.live ? '<span class="tag green">Live</span>' : '<span class="tag grey"><span class="d"></span>Off</span>'}</td>
                  <td>${[a.telegram ? chanTag("telegram") : "", a.web ? chanTag("web") : ""].filter(Boolean).join(" ") || '<span style="color:var(--muted)">none</span>'}</td>
                  <td>${num(a.usage.messages)}</td>
                  <td>${
                    a.unaided === null
                      ? '<span style="color:var(--muted)">no data yet</span>'
                      : `<div style="font-size:12px;margin-bottom:3px">${a.unaided}%</div><div class="bar"><i style="width:${a.unaided}%"></i></div>`
                  }</td>
                  <td style="color:var(--muted)">${h(ago(a.lastActivity))}</td>
                  <td>${
                    tryUrl(a)
                      ? `<a class="try-link" href="${h(tryUrl(a))}" target="_blank" rel="noopener"
                            title="Opens the chat your customers see">${icon("external", 13)}Open</a>`
                      : '<span style="color:var(--muted)">not on the web</span>'
                  }</td></tr>`,
              )
              .join("")}</tbody></table>
            <div class="tfoot"><span>Showing ${shown.length} of ${all.length} agents</span></div></div>`
    }`;
  for (const id of ["newBiz", "newBiz2"]) if ($(id)) $(id).onclick = () => createAgentDialog();
  $("view").querySelectorAll("[data-filter]").forEach(
    (b) => (b.onclick = () => ((state.filter = b.dataset.filter), render())),
  );
  $("view").querySelectorAll("tr[data-business]").forEach(
    (r) => (r.onclick = () => go("agents", { businessId: r.dataset.business, customerId: null })),
  );
}

/** One agent, its conversations, and the transcript beside them. */
/**
 * One agent, and every setting that changes how it answers.
 *
 * Not its conversations. Those are in Messages and in the Inbox, where they
 * belong: reading a chat and configuring the thing that writes the chats are
 * two jobs, and putting them on one screen meant the settings had nowhere to
 * live at all.
 *
 * Model, persona, skills, rules and features, which is the shape a person
 * already expects. Every switch under Features is one the deployment actually
 * reads before it answers; there is nothing here that only looks like it does
 * something.
 */
async function agentConfig() {
  const { ok, data } = await api(`businesses/${state.businessId}/agent`);
  if (!ok) {
    state.businessId = null;
    return render();
  }
  state.agent = data;
  const TABS = [
    ["model", "Model"],
    ["persona", "Persona"],
    ["skills", "Skills"],
    ["rules", "Rules"],
    ["features", "Features"],
  ];

  $("view").innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
      <a href="#" id="back" style="color:var(--muted);font-size:13px">← All agents</a>
      <b style="font-size:16px">${h(data.name)}</b>
      ${[
        data.features.telegram ? chanTag("telegram") : "",
        data.features.web ? chanTag("web") : "",
      ]
        .filter(Boolean)
        .join(" ")}
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" id="openChats">Conversations</button>
      <button class="btn btn-ghost btn-sm" id="openBiz">Its business</button>
    </div>
    <div class="subnav">${TABS.map(
      ([id, label]) => `<button data-atab="${id}" class="${state.agentTab === id ? "on" : ""}">${label}</button>`,
    ).join("")}</div>
    <div id="agentTab">${waitingMark()}</div>`;

  $("back").onclick = (e) => (e.preventDefault(), go("agents", { businessId: null, customerId: null }));
  $("openChats").onclick = () => go("messages", { customerId: null });
  $("openBiz").onclick = () => go("businesses", { businessId: state.businessId });
  $("view").querySelectorAll("[data-atab]").forEach(
    (t) => (t.onclick = () => ((state.agentTab = t.dataset.atab), agentConfig())),
  );

  ({
    model: agentModel,
    persona: agentPersona,
    skills: agentSkills,
    rules: agentRules,
    features: agentFeatures,
  }[state.agentTab] ?? agentModel)();
}

function agentModel() {
  const a = state.agent;
  $("agentTab").innerHTML = `
    <div class="card" style="max-width:720px">
      <div class="card-head"><h2>Which model answers</h2></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13px;margin:0 0 14px">Every one of these runs inside your own
          Cloudflare account, on your own daily allowance. A bigger model reads more of your documents before
          it answers and spends more of that allowance doing it.</p>
        <div class="picks">${(a.models ?? [])
          .map(
            (m) => `<label class="pick"><input type="radio" name="mdl" value="${h(m.id)}" ${
              m.id === a.model ? "checked" : ""
            }>
              <div><b>${h(m.label)}</b><small>${h(m.id)}</small></div></label>`,
          )
          .join("")}</div>
        <p style="color:var(--muted);font-size:12.5px;margin:0">Today this agent has answered
          ${num(a.usage?.messages)} messages, using
          ${num((a.usage?.inputTokens ?? 0) + (a.usage?.outputTokens ?? 0))} tokens.</p>
      </div>
    </div>`;
  $("agentTab").querySelectorAll('input[name="mdl"]').forEach((radio) => {
    radio.onchange = async () => {
      const { ok } = await api(`businesses/${state.businessId}`, {
        method: "PATCH",
        body: { model: radio.value },
      });
      if (!ok) return;
      state.overview = null;
      toast("Model changed.");
    };
  });
}

/** The persona is the business's instructions; this is the same words. */
async function agentPersona() {
  const a = state.agent;
  $("agentTab").innerHTML = `
    <div class="card" style="max-width:760px">
      <div class="card-head"><h2>How it should speak</h2>
        <span style="font-size:12.5px;color:var(--muted)"><span id="personaCount">${
          (a.persona ?? "").length
        }</span> / 8000</span></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13px;margin:0 0 12px">Its tone, what it will and will not
          promise, anything your price list and documents do not say. Standing instructions that can be
          switched on and off one at a time belong under Rules instead.</p>
        <textarea id="persona" rows="14" style="width:100%;resize:vertical"
          placeholder="Answer in a warm, short style. Never promise a delivery date. If someone asks for a discount, tell them to ask the owner."
        >${h(a.persona ?? "")}</textarea>
        <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
          <button class="btn btn-primary btn-sm" id="savePersona">Save</button>
          <span style="flex:1"></span>
          <span id="personaSaved" style="font-size:12.5px;color:var(--green)"></span>
        </div>
      </div>
    </div>`;
  const box = $("persona");
  box.oninput = () => ($("personaCount").textContent = box.value.length);
  $("savePersona").onclick = async () => {
    $("savePersona").disabled = true;
    const { ok } = await api(`businesses/${state.businessId}/prompt`, {
      method: "PUT",
      body: { prompt: box.value },
    });
    $("savePersona").disabled = false;
    if (!ok) return;
    state.agent.persona = box.value;
    $("personaSaved").textContent = "Saved";
    setTimeout(() => ($("personaSaved").textContent = ""), 2500);
  };
}

/**
 * The ready made personas.
 *
 * Said plainly: using one replaces what is written under Persona. They are
 * starting points, not capabilities that stack, and calling them anything else
 * would be the console describing a product it does not have.
 */
function agentSkills() {
  const a = state.agent;
  const locale = state.locale ?? "en";
  $("agentTab").innerHTML = `
    <div class="card" style="max-width:760px">
      <div class="card-head"><h2>Start from a ready made persona</h2></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13px;margin:0 0 13px">Each of these writes a full persona you
          can then edit. It <b>replaces</b> what is under Persona now, and that goes into the undo history
          first, so nothing is lost.</p>
        ${(a.skills ?? [])
          .map(
            (skill) => `<div class="skill" data-skill="${h(skill.id)}">
              <div><b>${h(skill.label[locale] ?? skill.label.en)}</b>
                <small>${h(skill.summary[locale] ?? skill.summary.en)}</small></div>
              <button class="btn btn-ghost btn-sm">Use</button></div>`,
          )
          .join("")}
      </div>
    </div>`;
  $("agentTab").querySelectorAll("[data-skill]").forEach(
    (el) =>
      (el.onclick = async () => {
        const choice = await ask(
          "Use this persona",
          "It replaces what is written under Persona now. That goes into the undo history, so this is reversible.",
          [{ key: "yes", label: "Use it", primary: true }],
        );
        if (!choice) return;
        const { ok } = await api(`businesses/${state.businessId}/skill`, {
          method: "POST",
          body: { id: el.dataset.skill },
        });
        if (!ok) return;
        toast("Persona replaced.");
        state.agentTab = "persona";
        agentConfig();
      }),
  );
}

const RULE_LABEL = {
  faq: "A question you are often asked",
  escalation: "When to fetch a person",
  delivery: "Delivery",
  payment: "Payment",
  refund: "Refunds and returns",
  other: "Standing instruction",
};

function agentRules() {
  const a = state.agent;
  const rules = a.rules ?? [];
  $("agentTab").innerHTML = `
    <div class="card" style="max-width:860px">
      <div class="card-head"><h2>Standing instructions</h2>
        <button class="btn btn-primary btn-sm" id="addRule">Add a rule</button></div>
      ${
        rules.length === 0
          ? `<div class="empty"><h3>No rules yet</h3>
               <p>A rule is one instruction the agent follows every time: what to say about delivery, when
                  to stop and fetch you, the answer to a question you are asked weekly. They can be switched
                  off one at a time, which a paragraph in the persona cannot.</p>
               <button class="btn btn-primary" id="addRule2">Add your first rule</button></div>`
          : `<table><thead><tr><th style="width:200px">Kind</th><th>What it says</th>
              <th style="width:90px">Order</th><th style="width:80px">On</th><th style="width:110px"></th></tr></thead>
             <tbody>${rules
               .map(
                 (r) => `<tr class="${r.active ? "" : "dim"}">
                   <td><span class="tag">${h(RULE_LABEL[r.kind] ?? r.kind)}</span></td>
                   <td>${h(r.content)}</td>
                   <td style="color:var(--muted)">${r.priority}</td>
                   <td><label class="switch"><input type="checkbox" data-toggle="${h(r.id)}" ${
                     r.active ? "checked" : ""
                   }></label></td>
                   <td style="text-align:right;white-space:nowrap">
                     <a href="#" data-edit="${h(r.id)}" style="color:var(--muted);font-size:12.5px">Edit</a>
                     <a href="#" data-del="${h(r.id)}" style="color:var(--muted);font-size:12.5px;margin-left:11px">Remove</a>
                   </td></tr>`,
               )
               .join("")}</tbody></table>
             <div class="tfoot"><span>${rules.filter((r) => r.active).length} of ${rules.length} switched on</span>
               <span>Lower numbers are read first.</span></div>`
      }
    </div>`;

  for (const id of ["addRule", "addRule2"]) if ($(id)) $(id).onclick = () => ruleDialog(null);
  $("agentTab").querySelectorAll("[data-edit]").forEach(
    (el) => (el.onclick = (e) => (e.preventDefault(), ruleDialog(rules.find((r) => r.id === el.dataset.edit)))),
  );
  $("agentTab").querySelectorAll("[data-toggle]").forEach((el) => {
    el.onchange = async () => {
      const rule = rules.find((r) => r.id === el.dataset.toggle);
      const { ok, data } = await api(`businesses/${state.businessId}/rules`, {
        method: "POST",
        body: { id: rule.id, kind: rule.kind, content: rule.content, priority: rule.priority, active: el.checked },
      });
      if (!ok) return;
      state.agent.rules = data.rules;
      agentRules();
    };
  });
  $("agentTab").querySelectorAll("[data-del]").forEach((el) => {
    el.onclick = async (e) => {
      e.preventDefault();
      const choice = await ask("Remove this rule", "The agent stops following it immediately.", [
        { key: "yes", label: "Remove", primary: true },
      ]);
      if (!choice) return;
      const { ok, data } = await api(`businesses/${state.businessId}/rules/${el.dataset.del}`, {
        method: "DELETE",
      });
      if (!ok) return;
      state.agent.rules = data.rules;
      agentRules();
    };
  });
}

function ruleDialog(rule) {
  const editing = rule != null;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">
    <h3>${editing ? "Edit this rule" : "Add a rule"}</h3>
    <p class="sub">One instruction the agent follows every time. Keep it to one thing, so you can switch
      that one thing off later without touching the rest.</p>
    <div class="field"><label>What kind</label>
      <select id="rKind">${Object.entries(RULE_LABEL)
        .map(
          ([id, label]) => `<option value="${id}" ${editing && rule.kind === id ? "selected" : ""}>${label}</option>`,
        )
        .join("")}</select></div>
    <div class="field"><label>What it says</label>
      <textarea id="rContent" rows="4"
        placeholder="Delivery inside Bangkok is 60 THB and takes one day. Outside Bangkok, tell them to ask us.">${
          editing ? h(rule.content) : ""
        }</textarea></div>
    <div class="field"><label>Order</label>
      <input id="rPriority" type="number" min="0" max="1000" value="${editing ? rule.priority : 100}">
      <small>Lower numbers are read first. Useful when two rules touch the same subject.</small></div>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" id="cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="save">${editing ? "Save" : "Add"}</button>
    </div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector("#cancel").onclick = close;
  bg.onclick = (e) => e.target === bg && close();
  bg.querySelector("#rContent").focus();
  bg.querySelector("#save").onclick = async () => {
    const content = bg.querySelector("#rContent").value.trim();
    if (!content) return;
    bg.querySelector("#save").disabled = true;
    const { ok, data } = await api(`businesses/${state.businessId}/rules`, {
      method: "POST",
      body: {
        ...(editing ? { id: rule.id, active: rule.active } : {}),
        kind: bg.querySelector("#rKind").value,
        content,
        priority: Number(bg.querySelector("#rPriority").value) || 100,
      },
    });
    if (!ok) return (bg.querySelector("#save").disabled = false);
    close();
    state.agent.rules = data.rules;
    agentRules();
  };
}

/**
 * The switches, each of which the deployment reads before it answers.
 *
 * Turning Telegram off really stops it: the reply path selects bots with
 * enabled = 1. Turning the website off really stops it: the widget route checks
 * the same flag. Turning remembering off stops the writing as well as the
 * reading, before the model is asked, not after. A switch that only changed a
 * label here would be worse than not offering it.
 */
function agentFeatures() {
  const f = state.agent.features ?? {};
  const row = (id, title, note, checked, disabled) => `
    <label class="feature ${disabled ? "off" : ""}">
      <div><b>${title}</b><small>${note}</small></div>
      <span class="switch"><input type="checkbox" data-feature="${id}" ${checked ? "checked" : ""} ${
        disabled ? "disabled" : ""
      }></span>
    </label>`;

  $("agentTab").innerHTML = `
    <div class="card" style="max-width:760px">
      <div class="card-head"><h2>What it does</h2></div>
      <div class="pad">
        ${row(
          "telegram",
          "Answer on Telegram",
          // One line on purpose: a break inside this string put the full stop
          // on its own line, after the bold username wrapped.
          f.telegram
            ? `Customers messaging <b>@${h(f.telegram.username)}</b>. Switching this off stops it replying. The bot stays attached and the conversations stay here.`
            : "No Telegram bot is attached to this business yet.",
          f.telegram?.enabled === true,
          f.telegram === null,
        )}
        ${row(
          "web",
          "Answer on your website",
          f.web
            ? "The chat bubble on your own pages. Switching this off makes the widget stop loading."
            : "This business has no website channel.",
          f.web?.enabled === true,
          f.web == null,
        )}
        ${row(
          "rememberCustomers",
          "Remember what customers tell it",
          "Notes like an allergy or a delivery preference, so it does not ask twice. Switched off it stops reading them and stops writing new ones. What was already remembered stays until you clear it on the customer.",
          f.rememberCustomers === true,
          false,
        )}
        ${
          f.web
            ? `<div class="field" style="max-width:260px;margin:16px 0 0">
                 <label>Daily message cap on the website</label>
                 <input id="dailyLimit" type="number" min="1" max="100000" value="${f.web.dailyLimit}">
                 <small>What one page can spend in a day, so a busy day or a bad actor cannot use up your
                   whole Cloudflare allowance. Telegram is not capped.</small>
                 <button class="btn btn-ghost btn-sm" id="saveLimit" style="margin-top:8px;align-self:flex-start">Save</button>
               </div>`
            : ""
        }
      </div>
    </div>`;

  $("agentTab").querySelectorAll("[data-feature]").forEach((el) => {
    el.onchange = async () => {
      const { ok } = await api(`businesses/${state.businessId}/features`, {
        method: "PATCH",
        body: { [el.dataset.feature]: el.checked },
      });
      if (!ok) {
        el.checked = !el.checked;
        return;
      }
      state.overview = null;
      toast(el.checked ? "Switched on." : "Switched off.");
      agentConfig();
    };
  });
  if ($("saveLimit"))
    $("saveLimit").onclick = async () => {
      const { ok } = await api(`businesses/${state.businessId}/features`, {
        method: "PATCH",
        body: { dailyLimit: Number($("dailyLimit").value) },
      });
      if (ok) toast("Daily cap saved.");
    };
}

// ------------------------------------------------------------------ messages

async function viewMessages() {
  const { data } = await api("conversations?limit=40");
  const conversations = (data.conversations ?? []).filter((c) => c.customerId !== null);
  if (conversations.length === 0) {
    $("view").innerHTML =
      '<div class="card empty"><h3>No conversations yet</h3><p>Everything a customer sends on any channel lands here.</p></div>';
    return;
  }
  if (!state.customerId || !conversations.some((c) => c.customerId === state.customerId)) {
    state.customerId = conversations[0].customerId;
  }
  $("view").innerHTML = `
    <div class="split">
      <div class="card list">${conversations
        .map(
          (c) => `<div class="it ${c.customerId === state.customerId ? "on" : ""}" data-customer="${h(c.customerId)}">
            <span class="ic" style="width:28px;height:28px;border-radius:7px;display:grid;place-items:center;flex:none;
              background:${CHANNEL_ICON[c.channel].bg};color:${CHANNEL_ICON[c.channel].fg}">
              ${icon(CHANNEL_ICON[c.channel].icon, 14)}</span>
            <div class="grow"><b>${h(nameOf({ name: c.customerName }))}</b>
              <small>${h(c.lastMessage)}</small></div>
            <time style="color:var(--muted);font-size:11.5px;white-space:nowrap">${h(ago(c.updatedAt))}</time>
          </div>`,
        )
        .join("")}</div>
      <div id="convPane"></div>
    </div>`;
  $("view").querySelectorAll(".it").forEach((it) => {
    it.onclick = () => {
      state.customerId = it.dataset.customer;
      $("view").querySelectorAll(".it").forEach((o) => o.classList.toggle("on", o === it));
      openConversation();
    };
  });
  openConversation();
}

async function openConversation(quiet = false) {
  const { ok, data } = await api(`conversations/${state.customerId}`);
  if (!ok) return;
  state.conversation = data;
  drawConversation();
  if (!quiet) {
    clearInterval(state.poll);
    // A live chat should move on its own. Eight seconds costs nothing and is
    // fast enough that nobody reaches for a refresh button that is not there.
    state.poll = setInterval(() => {
      if ((state.view === "agents" || state.view === "messages") && state.customerId) openConversation(true);
    }, 8000);
  }
}

function drawConversation() {
  const { customer, messages = [], handover } = state.conversation;
  const mine = handover?.state === "human";
  const pane = $("convPane");
  if (!pane) return;
  const atBottom = (() => {
    const box = pane.querySelector(".msgs");
    return !box || box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  })();

  pane.innerHTML = `
    <div class="card chat">
      <div class="chat-head">
        <div><b style="font-size:14.5px">${h(nameOf(customer))}</b>
          <div style="font-size:12px;color:var(--muted)">${
            customer.username ? "@" + h(customer.username) + " · " : ""
          }${customer.messageCount} messages · ${h(ago(customer.lastSeen))}</div></div>
        <div style="display:flex;gap:8px">
          ${
            mine
              ? '<button class="btn btn-ghost btn-sm" id="release">Give back to the agent</button>'
              : '<button class="btn btn-primary btn-sm" id="takeover">Take over</button>'
          }
          <button class="btn btn-ghost btn-sm" id="wipe">Delete chat</button>
        </div>
      </div>
      <div class="msgs" id="msgs">${messages
        .map((m) => {
          const who = m.role === "user" ? "user" : m.sentBy === "human" ? "human" : "bot";
          const label = who === "user" ? h(nameOf(customer)) : who === "human" ? "You" : "Agent";
          return `<div class="msg ${who}" data-message="${h(m.id)}">
              <span class="who">${label} · ${h(ago(m.createdAt))}</span><span class="body">${h(m.content)}</span>
              ${m.media ? `<div class="att" data-media="${h(m.id)}" data-kind="${h(m.media.kind)}"></div>` : ""}
              <div class="acts">
                ${who === "user" ? "" : `<a href="#" data-edit="${h(m.id)}">Edit</a>`}
                <a href="#" data-del="${h(m.id)}">Delete</a>
              </div></div>`;
        })
        .join("")}</div>
      <form class="reply-bar" id="say">
        <input id="sayText" placeholder="${
          mine ? "Type your reply and press enter" : "Take over first, then you can reply here"
        }" ${mine ? "" : "disabled"} autocomplete="off">
        <button type="button" class="btn btn-ghost btn-sm" id="attach" ${mine ? "" : "disabled"}>File</button>
        <button class="btn btn-primary btn-sm" type="submit" ${mine ? "" : "disabled"}>Send</button>
        <input type="file" id="file" hidden>
      </form>
    </div>`;

  const box = $("msgs");
  if (atBottom) box.scrollTop = box.scrollHeight;
  if ($("takeover")) $("takeover").onclick = () => handoverTo("takeover");
  if ($("release")) $("release").onclick = () => handoverTo("release");
  $("wipe").onclick = deleteConversation;
  $("attach").onclick = () => $("file").click();
  $("file").onchange = sendFile;
  $("say").onsubmit = sendText;
  pane.querySelectorAll("[data-edit]").forEach((a) => (a.onclick = (e) => (e.preventDefault(), editMessage(a.dataset.edit))));
  pane.querySelectorAll("[data-del]").forEach((a) => (a.onclick = (e) => (e.preventDefault(), deleteMessage(a.dataset.del))));
  pane.querySelectorAll("[data-media]").forEach(loadAttachment);
}

/**
 * Fetches an attachment and puts it in the bubble.
 *
 * Loaded with the token in a header and handed to the page as an object URL,
 * because an <img src> cannot carry authentication and a link that did not need
 * it would be a customer's photo readable by anyone who guessed the address.
 */
async function loadAttachment(box) {
  const { ok, data } = await api(`messages/${box.dataset.media}/media`, { blob: true });
  if (!ok || !data) {
    box.innerHTML = `<span style="font-size:12px;color:var(--muted)">${h(box.dataset.kind)} · no longer available</span>`;
    return;
  }
  const url = URL.createObjectURL(data);
  box.innerHTML = data.type.startsWith("image/")
    ? `<img src="${url}" alt="${h(box.dataset.kind)}">`
    : data.type.startsWith("video/")
      ? `<video src="${url}" controls></video>`
      : `<a href="${url}" download style="font-size:13px">Download the ${h(box.dataset.kind)}</a>`;
}

async function handoverTo(what) {
  const { ok } = await api(`conversations/${state.customerId}/${what}`, { method: "POST" });
  if (ok) openConversation();
}

async function sendText(event) {
  event.preventDefault();
  const input = $("sayText");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const { ok, data } = await api(`conversations/${state.customerId}/send`, { method: "POST", body: { text } });
  if (!ok) {
    input.value = text;
    return;
  }
  state.conversation.messages = data.messages;
  drawConversation();
}

async function sendFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = "";
  toast(`Sending ${file.name}…`);
  const { ok, data } = await api(`conversations/${state.customerId}/media`, {
    method: "POST",
    raw: true,
    body: file,
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-filename": file.name.replace(/[^\x20-\x7e]/g, "_"),
    },
  });
  if (!ok) return;
  state.conversation.messages = data.messages;
  drawConversation();
  toast("Sent.");
}

async function editMessage(messageId) {
  const current = state.conversation.messages.find((m) => m.id === messageId);
  const text = prompt("Edit this message", current?.content ?? "");
  if (text === null || text.trim() === "") return;
  const { ok, data } = await api(`messages/${messageId}`, { method: "PATCH", body: { text } });
  if (!ok) return;
  state.conversation.messages = data.messages;
  drawConversation();
  // Said plainly: the two outcomes are genuinely different and the operator is
  // the only one who can see which one they needed.
  toast(data.onWire ? "Changed here and in the chat." : "Changed here only. The sent copy is unchanged.");
}

async function deleteMessage(messageId) {
  const choice = await ask("Delete this message", "The chat copy can only be withdrawn within 48 hours of sending.", [
    { key: "everyone", label: "Delete for everyone", primary: true },
    { key: "me", label: "Delete for me only" },
  ]);
  if (!choice) return;
  const { ok, data } = await api(`messages/${messageId}?scope=${choice}`, { method: "DELETE" });
  if (!ok) return;
  state.conversation.messages = data.messages;
  drawConversation();
  toast(
    choice === "everyone" && data.onWire
      ? "Withdrawn from the chat."
      : "Removed from your console. The chat copy stays.",
  );
}

async function deleteConversation() {
  const choice = await ask(
    "Delete this conversation",
    "Every message in it goes from your console. The customer's own copy is theirs and stays where it is.",
    [{ key: "yes", label: "Delete", primary: true }],
  );
  if (!choice) return;
  const { ok } = await api(`conversations/${state.customerId}`, { method: "DELETE" });
  if (!ok) return;
  state.customerId = null;
  toast("Conversation deleted.");
  render();
}

// ------------------------------------------------------------------ channels

async function viewChannels() {
  const { data } = await api("channels");
  const all = data.channels ?? [];
  const shown = all.filter((c) =>
    state.filter === "all" ? true : state.filter === "on" ? c.connected : !c.connected,
  );
  $("view").innerHTML = `
    <div class="page-actions"><button class="btn btn-primary btn-sm" id="newBiz">${icon("plus", 15)}Add channel</button></div>
    <div class="tabs">
      <button data-filter="all" class="${state.filter === "all" ? "on" : ""}">All<span class="n">${all.length}</span></button>
      <button data-filter="on" class="${state.filter === "on" ? "on" : ""}">Connected<span class="n">${all.filter((c) => c.connected).length}</span></button>
      <button data-filter="off" class="${state.filter === "off" ? "on" : ""}">Off<span class="n">${all.filter((c) => !c.connected).length}</span></button>
    </div>
    ${
      all.length === 0
        ? `<div class="card empty"><h3>No channels yet</h3>
             <p>A channel is how a customer reaches you: a Telegram bot, or the chat bubble on your website.
                Each one belongs to a business, so this asks which.</p>
             <button class="btn btn-primary" id="newBiz2">Add a channel</button></div>`
        : `<div class="card"><table>
            <thead><tr><th>Channel</th><th>Type</th><th>Status</th><th>Answers for</th><th>Last activity</th></tr></thead>
            <tbody>${shown
              .map(
                (c) => `<tr class="click" data-business="${h(c.businessId)}">
                  <td>${chanTag(c.kind)}</td>
                  <td style="color:var(--muted)">${c.kind === "telegram" ? h(c.label) : "Website widget"}</td>
                  <td>${c.connected ? '<span class="tag green">Connected</span>' : '<span class="tag grey"><span class="d"></span>Off</span>'}</td>
                  <td>${h(c.businessName)}</td>
                  <td style="color:var(--muted)">${h(ago(c.lastActivity))}</td></tr>`,
              )
              .join("")}</tbody></table>
            <div class="tfoot">
              <span>Showing ${shown.length} of ${all.length} channels</span>
              <span>Muxel answers on Telegram and on your website. Those are the two.</span>
            </div></div>`
    }`;
  for (const id of ["newBiz", "newBiz2"]) if ($(id)) $(id).onclick = () => createAgentDialog();
  $("view").querySelectorAll("[data-filter]").forEach(
    (b) => (b.onclick = () => ((state.filter = b.dataset.filter), render())),
  );
  $("view").querySelectorAll("tr[data-business]").forEach(
    (r) => (r.onclick = () => go("businesses", { businessId: r.dataset.business })),
  );
}

// ----------------------------------------------------------------- customers

/**
 * Everyone who has written, and the ones still waiting on a person.
 *
 * Two tabs over the same people rather than two screens: "who wrote to us" and
 * "who needs me now" are the same list asked two different questions, and the
 * queue was its own rail item back when it was the only way to see it.
 */
async function viewCustomers() {
  const [people, queue] = await Promise.all([
    api(`customers?page=${state.page}&size=20`),
    api("inbox", { quiet: true }),
  ]);
  const waiting = queue.data.waiting ?? [];
  state.waiting = waiting.filter((item) => item.state === "waiting").length;
  drawNavBadge();

  const tabs = `<div class="tabs">
      <button data-tab="all" class="${state.custTab === "waiting" ? "" : "on"}">Everyone<span class="n">${num(
        people.data.total ?? 0,
      )}</span></button>
      <button data-tab="waiting" class="${state.custTab === "waiting" ? "on" : ""}">Waiting for you${
        waiting.length > 0 ? `<span class="n">${waiting.length}</span>` : ""
      }</button>
    </div>`;

  if (state.custTab === "waiting") {
    $("view").innerHTML = tabs + waitingTable(waiting);
    wireWaiting();
    wireCustTabs();
    return;
  }

  const data = people.data;
  const rows = data.customers ?? [];
  $("view").innerHTML =
    tabs +
    (rows.length === 0 && state.page === 1
      ? '<div class="card empty"><h3>No customers yet</h3><p>Anyone who writes to one of your agents appears here.</p></div>'
      : `<div class="card"><table>
          <thead><tr><th>Customer</th><th>Channel</th><th>Business</th><th>Messages</th>
            <th>Conversations</th><th>Last contact</th></tr></thead>
          <tbody>${rows
            .map(
              (c) => `<tr class="click" data-customer="${h(c.id)}">
                <td><b>${h(c.name || "Someone")}</b>${
                  c.username ? `<div style="color:var(--muted);font-size:12px">@${h(c.username)}</div>` : ""
                }</td>
                <td>${chanTag(c.channel)}</td>
                <td>${h(c.businessName)}</td>
                <td>${num(c.messageCount)}</td>
                <td>${num(c.conversations)}</td>
                <td style="color:var(--muted)">${h(ago(c.lastSeen))}</td></tr>`,
            )
            .join("")}</tbody></table>
          <div class="tfoot">
            <span>Showing ${(data.page - 1) * data.size + 1} to ${
              (data.page - 1) * data.size + rows.length
            } of ${num(data.total)} customers</span>
            ${pager(data.page, data.pages)}
          </div></div>`);
  wirePager();
  wireCustTabs();
  $("view").querySelectorAll("tr[data-customer]").forEach(
    (r) => (r.onclick = () => customerDrawer(r.dataset.customer)),
  );
}

function wireCustTabs() {
  $("view").querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      state.custTab = b.dataset.tab;
      state.page = 1;
      viewCustomers();
    };
  });
}

function pager(page, pages) {
  if (pages <= 1) return "";
  const nums = [];
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return `<div class="pager">
    <button data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>‹</button>
    ${nums
      .map((p) =>
        p === "…"
          ? '<button disabled>…</button>'
          : `<button data-page="${p}" class="${p === page ? "on" : ""}">${p}</button>`,
      )
      .join("")}
    <button data-page="${page + 1}" ${page === pages ? "disabled" : ""}>›</button></div>`;
}

function wirePager() {
  $("view").querySelectorAll("[data-page]").forEach(
    (b) => (b.onclick = () => ((state.page = Number(b.dataset.page)), render())),
  );
}

/**
 * One person: what is remembered about them, and the switches that change it.
 *
 * Forgetting what was remembered and forgetting the person are two different
 * requests, so they are two buttons with two different sentences. Blocking is a
 * stage rather than a delete, because a blocked customer who writes again
 * should stay blocked rather than arrive as a stranger.
 */
async function customerDrawer(customerId) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" style="max-width:560px">${waitingMark()}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.onclick = (e) => e.target === bg && close();

  const { ok, data } = await api(`customers/${customerId}`);
  if (!ok) return close();
  const c = data.customer;
  const STAGES = [
    ["new", "New"],
    ["lead", "Interested"],
    ["customer", "Customer"],
    ["blocked", "Blocked"],
  ];

  bg.querySelector(".modal").innerHTML = `
    <h3 style="margin:0 0 3px">${h(nameOf(c))}</h3>
    <p class="sub">${c.username ? "@" + h(c.username) + " · " : ""}${h(data.businessName)} ·
      ${c.messageCount} messages · last seen ${h(ago(c.lastSeen))}</p>

    <div class="field"><label>Stage</label>
      <select id="cStage">${STAGES.map(
        ([id, label]) => `<option value="${id}" ${c.stage === id ? "selected" : ""}>${label}</option>`,
      ).join("")}</select>
      <small>Blocked means the agent stops answering them, and keeps not answering if they write again.</small>
    </div>

    <div class="field"><label>Your note</label>
      <textarea id="cNote" rows="3" maxlength="500"
        placeholder="Anything you want to remember about them.">${h(c.note ?? "")}</textarea>
    </div>

    <div class="field" style="margin-bottom:10px">
      <label>What the agent remembers <span style="font-weight:400;color:var(--muted)">(${
        (data.facts ?? []).length
      })</span></label>
      ${
        (data.facts ?? []).length === 0
          ? '<small>Nothing yet. It writes these down as it talks to them.</small>'
          : `<div class="facts">${data.facts
              .map((fact) => `<div>${h(fact.fact)}</div>`)
              .join("")}</div>
             <a href="#" id="forgetFacts" style="font-size:12.5px;color:var(--muted);margin-top:7px">Forget all of it</a>`
      }
    </div>

    <div class="actions" style="justify-content:space-between">
      <button class="btn btn-danger btn-sm" id="forgetAll">Forget this person</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" id="openChat">Open the chat</button>
        <button class="btn btn-primary btn-sm" id="saveCust">Save</button>
      </div>
    </div>`;

  bg.querySelector("#saveCust").onclick = async () => {
    await api(`customers/${customerId}`, {
      method: "PATCH",
      body: { note: bg.querySelector("#cNote").value, stage: bg.querySelector("#cStage").value },
    });
    close();
    toast("Saved.");
    render();
  };
  bg.querySelector("#openChat").onclick = () => (close(), go("messages", { customerId }));
  if (bg.querySelector("#forgetFacts"))
    bg.querySelector("#forgetFacts").onclick = async (e) => {
      e.preventDefault();
      const choice = await ask(
        "Forget what the agent remembers",
        "The conversation stays. Only the notes it made about this person while talking to them go.",
        [{ key: "yes", label: "Forget it", primary: true }],
      );
      if (!choice) return;
      await api(`customers/${customerId}/facts`, { method: "DELETE" });
      close();
      customerDrawer(customerId);
    };
  bg.querySelector("#forgetAll").onclick = async () => {
    const choice = await ask(
      `Forget ${nameOf(c)}`,
      "Their record and everything remembered about them goes. If they write again they arrive as a stranger.",
      [{ key: "yes", label: "Forget them", primary: true }],
    );
    if (!choice) return;
    await api(`customers/${customerId}`, { method: "DELETE" });
    close();
    toast("Forgotten.");
    render();
  };
}

// ---------------------------------------------------------------------- logs

async function viewLogs() {
  const { data } = await api("events?limit=100");
  const events = data.events ?? [];
  $("view").innerHTML =
    events.length === 0
      ? '<div class="card empty"><h3>Nothing recorded yet</h3><p>This is the deployment\'s own event log, not a summary of it.</p></div>'
      : `<div class="card"><table>
          <thead><tr><th style="width:130px">When</th><th style="width:190px">Business</th>
            <th style="width:190px">Event</th><th>Detail</th></tr></thead>
          <tbody>${events
            .map(
              (e) => `<tr><td style="color:var(--muted)">${h(ago(e.createdAt))}</td>
                <td>${h(e.businessName ?? "—")}</td>
                <td><span class="tag">${h(e.kind.replace(/_/g, " "))}</span></td>
                <td style="color:var(--muted)">${h(e.detail)}</td></tr>`,
            )
            .join("")}</tbody></table>
          <div class="tfoot"><span>${events.length} most recent events</span></div></div>`;
}

// ---------------------------------------------------------------- businesses

async function viewBusinesses() {
  if (state.businessId) return businessDetail(state.businessId);
  const d = await overview(true);
  const businesses = d.businesses ?? [];
  $("view").innerHTML = `
    <div class="page-actions"><button class="btn btn-primary btn-sm" id="newBiz">${icon("plus", 15)}Create business</button></div>
    ${
      businesses.length === 0
        ? `<div class="card empty"><h3>No businesses yet</h3>
             <p>A business is one assistant: one price list, one voice, and the channels it answers on.</p>
             <button class="btn btn-primary" id="newBiz2">Create your first business</button></div>`
        : `<div class="card"><table>
            <thead><tr><th>Business</th><th>Channels</th><th>Model</th><th>Messages today</th>
              <th>Customers</th><th>Created</th></tr></thead>
            <tbody>${businesses
              .map(
                (b) => `<tr class="click" data-business="${h(b.id)}">
                  <td><b>${h(b.name)}</b></td>
                  <td>${[b.telegram ? chanTag("telegram") : "", b.web ? chanTag("web") : ""].filter(Boolean).join(" ") || '<span style="color:var(--muted)">none</span>'}</td>
                  <td style="color:var(--muted)">${h(b.modelLabel)}</td>
                  <td>${num(b.usage.messages)}</td>
                  <td>${num(b.customers)}</td>
                  <td style="color:var(--muted)">${h(new Date(b.createdAt).toLocaleDateString())}</td></tr>`,
              )
              .join("")}</tbody></table>
            <div class="tfoot"><span>Showing ${businesses.length} of ${businesses.length} businesses</span></div></div>`
    }`;
  for (const id of ["newBiz", "newBiz2"]) if ($(id)) $(id).onclick = createBusinessDialog;
  $("view").querySelectorAll("tr[data-business]").forEach(
    (r) => (r.onclick = () => businessDetail(r.dataset.business)),
  );
}

async function businessDetail(businessId) {
  state.businessId = businessId;
  $("view").innerHTML = waitingMark();
  const { ok, data: b } = await api(`businesses/${businessId}`);
  if (!ok) return;

  const TABS = [
    ["overview", "Overview"],
    ["profile", "Profile"],
    ["knowledge", "Knowledge"],
    ["prices", "Price list"],
    ["notes", "Notes"],
    ["documents", "Documents"],
    ["website", "Website"],
  ];

  $("view").innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
      <a href="#" id="back" style="color:var(--muted);font-size:13px">← All businesses</a>
      <b style="font-size:16px">${h(b.name)}</b>
      ${[b.telegram ? chanTag("telegram") : "", b.web ? chanTag("web") : ""].filter(Boolean).join(" ")}
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" id="openChats">Conversations</button>
    </div>

    <div class="grid g4" style="margin-bottom:18px">
      ${statCard("messages", "var(--violet)", "var(--violet-soft)", "Messages today", num(b.usage.messages))}
      ${statCard("customers", "var(--green)", "var(--green-soft)", "Customers", num(b.customers))}
      ${statCard("businesses", "var(--brand-ink)", "var(--brand-soft)", "Price list", num((b.products ?? []).length))}
      ${statCard("logs", "var(--blue)", "var(--blue-soft)", "Documents", num((b.documents ?? []).length))}
    </div>

    <div class="subnav">${TABS.map(
      ([id, label]) => `<button data-btab="${id}" class="${state.bizTab === id ? "on" : ""}">${label}</button>`,
    ).join("")}</div>
    <div id="bizTab">${waitingMark()}</div>`;

  $("back").onclick = (e) => (e.preventDefault(), (state.businessId = null), render());
  $("openChats").onclick = () => go("agents", { businessId, customerId: null });
  $("view").querySelectorAll("[data-btab]").forEach(
    (t) => (t.onclick = () => ((state.bizTab = t.dataset.btab), businessDetail(businessId))),
  );

  ({
    overview: bizOverview,
    profile: bizProfile,
    knowledge: bizKnowledge,
    notes: bizNotes,
    prices: bizPrices,
    documents: bizDocuments,
    website: bizWebsite,
  }[state.bizTab] ?? bizOverview)(businessId, b);
}

async function bizOverview(businessId, b) {
  const models = await loadModels();
  $("bizTab").innerHTML = `
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h2>Which model answers</h2></div>
        <div class="pad">
          <p style="color:var(--muted);font-size:13px;margin:0 0 13px">Every one of these runs inside your own
            Cloudflare account. A bigger model reads more before it answers and uses more of your daily allowance.</p>
          <div class="field" style="max-width:380px;margin:0">
            <select id="model">${models
              .map((m) => `<option value="${h(m.id)}" ${m.id === b.model ? "selected" : ""}>${h(m.label)}</option>`)
              .join("")}</select>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Telegram</h2></div>
        <div class="pad">
          ${
            b.telegram
              ? `<p style="margin:0">Answering as <b>@${h(b.telegram.username)}</b>.</p>
                 <p style="margin:8px 0 0;color:var(--muted);font-size:13px">To point a different bot at this
                   business, remove this one from BotFather first.</p>`
              : `<div class="field" style="margin:0"><label>Attach a Telegram bot</label>
                   <div style="display:flex;gap:8px">
                     <input id="botToken" type="password" placeholder="123456:ABC-DEF…" autocomplete="off" style="flex:1">
                     <button class="btn btn-primary btn-sm" id="attachBot">Attach</button></div>
                   <small>Create it with @BotFather. It is sealed with your deployment's own key and stored
                     in your own Cloudflare account, never sent anywhere else.</small></div>`
          }
        </div>
      </div>
    </div>

    <div class="card" style="border-color:var(--line)">
      <div class="card-head"><h2>Delete this business</h2></div>
      <div class="pad" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <p style="margin:0;color:var(--muted);font-size:13.5px;flex:1;min-width:280px">Its conversations, price
          list and documents go with it, and any Telegram bot pointed at it stops answering. This cannot be undone.</p>
        <button class="btn btn-danger btn-sm" id="delBiz">Delete ${h(b.name)}</button>
      </div>
    </div>`;

  $("model").onchange = async (e) => {
    await api(`businesses/${businessId}`, { method: "PATCH", body: { model: e.target.value } });
    state.overview = null;
    toast("Model changed.");
  };
  if ($("attachBot"))
    $("attachBot").onclick = async () => {
      const value = $("botToken").value.trim();
      if (!value) return;
      $("attachBot").disabled = true;
      const { ok } = await api(`businesses/${businessId}/telegram`, { method: "POST", body: { token: value } });
      $("attachBot").disabled = false;
      if (ok) {
        state.overview = null;
        toast("Bot attached. It is answering now.");
        businessDetail(businessId);
      }
    };
  $("delBiz").onclick = async () => {
    const choice = await ask(
      `Delete ${b.name}`,
      "Its conversations, price list and documents go with it. Any Telegram bot pointed at it stops answering.",
      [{ key: "yes", label: "Delete", primary: true }],
    );
    if (!choice) return;
    await api(`businesses/${businessId}`, { method: "DELETE" });
    state.overview = null;
    state.businessId = null;
    go("businesses");
  };
}

/**
 * Everything the assistant can draw on, in one list.
 *
 * Split across four screens, "why did it say that" has four places to look and
 * no answer in any of them. The two halves are named for what actually happens
 * to them: some are searched when a question resembles them, and some are small
 * enough to go with every question and so cannot be missed by a search that did
 * not match.
 */
async function bizKnowledge(businessId) {
  const { ok, data } = await api(`businesses/${businessId}/knowledge`);
  if (!ok) return;
  const row = (s, clickable) => `
    <tr class="${clickable ? "click" : ""}" ${clickable ? `data-goto-tab="${h(clickable)}"` : ""}>
      <td><b>${h(s.name)}</b><div style="color:var(--muted);font-size:12px">${h(s.detail)}</div></td>
      <td>${
        s.status === "ready"
          ? '<span class="tag green">Ready</span>'
          : s.status === "empty"
            ? '<span class="tag grey"><span class="d"></span>Nothing in it</span>'
            : s.error
              ? `<span class="tag amber">Failed</span> <span style="color:var(--muted)">${h(s.error)}</span>`
              : `<span class="tag">${h(s.status)}</span>`
      }</td>
      <td>${s.pieces === undefined ? "—" : num(s.pieces)}</td>
      <td style="color:var(--muted)">${s.updatedAt ? h(ago(s.updatedAt)) : "—"}</td>
    </tr>`;

  $("bizTab").innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>Searched when a question matches</h2>
        <span style="font-size:12.5px;color:var(--muted)">One index, whatever shape it arrived in</span></div>
      <table><thead><tr><th>Source</th><th>State</th><th>Pieces</th><th>Last change</th></tr></thead>
        <tbody>${data.searched
          .map((s) => row(s, s.kind === "products" ? "prices" : s.kind === "notes" ? "notes" : "documents"))
          .join("")}</tbody></table>
      <div class="tfoot"><span>${data.searched.length} sources</span>
        <span>Every edit is indexed as you make it, not on a schedule.</span></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Sent with every question</h2>
        <span style="font-size:12.5px;color:var(--muted)">Too small and too often needed to be searched for</span></div>
      <table><thead><tr><th>Source</th><th>State</th><th></th><th></th></tr></thead>
        <tbody>${data.alwaysSent
          .map((s) => row(s, s.kind === "profile" ? "profile" : null))
          .join("")}</tbody></table>
      <div class="tfoot"><span>Standing instructions are on the agent, under Rules.</span></div>
    </div>`;

  $("bizTab").querySelectorAll("[data-goto-tab]").forEach(
    (r) => (r.onclick = () => ((state.bizTab = r.dataset.gotoTab), businessDetail(businessId))),
  );
}

/**
 * The facts an owner has in their head and no file for.
 *
 * Delivery areas, which day the supplier comes, what to say about the car park.
 * They used to go into the instructions or nowhere, and instructions are read
 * every turn whether or not they are relevant, which is the wrong place for a
 * hundred small facts. These are indexed and found when they are asked about.
 */
async function bizNotes(businessId) {
  const { ok, data } = await api(`businesses/${businessId}/notes`);
  if (!ok) return;
  const notes = data.notes ?? [];
  $("bizTab").innerHTML = `
    <div class="card" style="max-width:860px">
      <div class="card-head"><h2>Notes</h2>
        <button class="btn btn-primary btn-sm" id="addNote">Add a note</button></div>
      ${
        notes.length === 0
          ? `<div class="empty"><h3>Nothing written down yet</h3>
               <p>Anything you know that is not in a file and is not a price. Where you deliver, which day
                  the supplier comes, what to tell someone asking about parking. The assistant finds these
                  the same way it finds a document, and you can edit one line without touching the rest.</p>
               <button class="btn btn-primary" id="addNote2">Write your first note</button></div>`
          : `<table><thead><tr><th style="width:220px">About</th><th>What it says</th>
              <th style="width:120px">Changed</th><th style="width:110px"></th></tr></thead>
             <tbody>${notes
               .map(
                 (n) => `<tr><td><b>${h(n.title || "Untitled")}</b></td>
                   <td style="color:var(--muted)">${h(n.body.length > 180 ? n.body.slice(0, 180) + "…" : n.body)}</td>
                   <td style="color:var(--muted)">${h(ago(n.updatedAt))}</td>
                   <td style="text-align:right;white-space:nowrap">
                     <a href="#" data-edit="${h(n.id)}" style="color:var(--muted);font-size:12.5px">Edit</a>
                     <a href="#" data-del="${h(n.id)}" style="color:var(--muted);font-size:12.5px;margin-left:11px">Remove</a>
                   </td></tr>`,
               )
               .join("")}</tbody></table>
             <div class="tfoot"><span>${notes.length} note${notes.length === 1 ? "" : "s"}</span>
               <span>Indexed as you save, so the agent can find one the moment you write it.</span></div>`
      }
    </div>`;

  for (const id of ["addNote", "addNote2"]) if ($(id)) $(id).onclick = () => noteDialog(businessId, null);
  $("bizTab").querySelectorAll("[data-edit]").forEach(
    (a) => (a.onclick = (e) => (e.preventDefault(), noteDialog(businessId, notes.find((n) => n.id === a.dataset.edit)))),
  );
  $("bizTab").querySelectorAll("[data-del]").forEach((a) => {
    a.onclick = async (e) => {
      e.preventDefault();
      const choice = await ask("Remove this note", "The agent stops finding it immediately.", [
        { key: "yes", label: "Remove", primary: true },
      ]);
      if (!choice) return;
      await api(`businesses/${businessId}/notes/${a.dataset.del}`, { method: "DELETE" });
      bizNotes(businessId);
    };
  });
}

function noteDialog(businessId, note) {
  const editing = note != null;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" style="max-width:560px">
    <h3>${editing ? "Edit this note" : "Write a note"}</h3>
    <p class="sub">Anything you know that is not a file and not a price. Write it the way you would say it.</p>
    <div class="field"><label>What it is about</label>
      <input id="nTitle" placeholder="Delivery areas" value="${editing ? h(note.title) : ""}"></div>
    <div class="field"><label>What it says</label>
      <textarea id="nBody" rows="6"
        placeholder="We deliver anywhere inside Bangkok. Nonthaburi and Samut Prakan on Fridays only. Anywhere else, we post it and it takes two days.">${
          editing ? h(note.body) : ""
        }</textarea></div>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" id="cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="save">${editing ? "Save" : "Add"}</button>
    </div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector("#cancel").onclick = close;
  bg.onclick = (e) => e.target === bg && close();
  bg.querySelector("#nBody").focus();
  bg.querySelector("#save").onclick = async () => {
    const body = bg.querySelector("#nBody").value.trim();
    if (!body) return;
    bg.querySelector("#save").disabled = true;
    const { ok } = await api(`businesses/${businessId}/notes`, {
      method: "POST",
      body: { ...(editing ? { id: note.id } : {}), title: bg.querySelector("#nTitle").value, body },
    });
    if (!ok) return (bg.querySelector("#save").disabled = false);
    close();
    toast("Saved and indexed.");
    bizNotes(businessId);
  };
}

/**
 * The facts about the business, as the fields they are.
 *
 * These go to the assistant as plain lines it can quote, and only the ones with
 * something in them. An empty field is not a blank the assistant fills in: it
 * is something it is not told, and it says it does not know instead.
 */
async function bizProfile(businessId, b) {
  const profile = b.profile ?? {};
  $("bizTab").innerHTML = `
    <div class="card" style="max-width:760px">
      <div class="card-head"><h2>About this business</h2>
        <span id="profSaved" style="font-size:12.5px;color:var(--green)"></span></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13px;margin:0 0 14px">Where you are and how to reach you are
          the two things customers ask most, and neither is in a price list. Anything you fill in here the
          assistant can quote. Anything you leave blank it will say it does not know.</p>
        <div class="two">${profileInputs(profile)}</div>
        <button class="btn btn-primary btn-sm" id="saveProfile" style="margin-top:4px">Save</button>
      </div>
    </div>`;
  $("saveProfile").onclick = async () => {
    $("saveProfile").disabled = true;
    const { ok } = await api(`businesses/${businessId}/profile`, {
      method: "PUT",
      body: readProfileInputs($("bizTab")),
    });
    $("saveProfile").disabled = false;
    if (!ok) return;
    $("profSaved").textContent = "Saved";
    setTimeout(() => ($("profSaved").textContent = ""), 2500);
  };
}

async function bizPrices(businessId) {
  const { data } = await api(`businesses/${businessId}/products`);
  const items = data.products ?? [];
  $("bizTab").innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Price list</h2>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" id="rescan">Read the documents again</button>
          <button class="btn btn-primary btn-sm" id="addProduct">Add item</button>
        </div></div>
      <div id="rescanState" hidden class="pad" style="padding-bottom:0"></div>
      ${
        items.length === 0
          ? `<div class="empty"><h3>Nothing here yet</h3>
               <p>The agent quotes from this list and nowhere else. With it empty it says it does not know a
                  price rather than inventing one, which is the right answer and a slow way to sell. Type the
                  items in, or upload a price list under Documents and they are read out of it.</p>
               <button class="btn btn-primary" id="addProduct2">Add your first item</button></div>`
          : `<table><thead><tr><th>Item</th><th>Price</th><th>Description</th><th>Source</th><th></th></tr></thead>
             <tbody>${items
               .map(
                 (p) => `<tr><td><b>${h(p.name)}</b></td><td>${h(p.price || "—")}</td>
                   <td style="color:var(--muted)">${h(p.description)}</td>
                   <td>${
                     p.source
                       ? `<span class="tag">${h(p.source)}</span>${
                           p.edited ? ' <span class="tag brand">edited</span>' : ""
                         }`
                       : '<span class="tag brand">typed here</span>'
                   }</td>
                   <td style="text-align:right;white-space:nowrap">
                     <a href="#" data-edit="${h(p.key)}" style="color:var(--muted);font-size:12.5px">Edit</a>
                     <a href="#" data-del="${h(p.key)}" style="color:var(--muted);font-size:12.5px;margin-left:11px">Remove</a>
                   </td></tr>`,
               )
               .join("")}</tbody></table>
             <div class="tfoot"><span>${items.length} item${items.length === 1 ? "" : "s"}</span>
               <span>Anything changed here overrides what the documents say.</span></div>`
      }
    </div>`;

  for (const id of ["addProduct", "addProduct2"]) if ($(id)) $(id).onclick = () => productDialog(businessId, null);
  $("bizTab").querySelectorAll("[data-edit]").forEach(
    (a) =>
      (a.onclick = (e) => {
        e.preventDefault();
        productDialog(businessId, items.find((p) => p.key === a.dataset.edit));
      }),
  );
  $("bizTab").querySelectorAll("[data-del]").forEach(
    (a) =>
      (a.onclick = async (e) => {
        e.preventDefault();
        const item = items.find((p) => p.key === a.dataset.del);
        const choice = await ask(
          `Remove ${item.name}`,
          item.source
            ? `It stays in ${item.source}, and the agent is told not to quote it any more. Reading that file again will not bring it back.`
            : "The agent stops quoting it.",
          [{ key: "yes", label: "Remove", primary: true }],
        );
        if (!choice) return;
        await api(`businesses/${businessId}/products/${encodeURIComponent(a.dataset.del)}`, { method: "DELETE" });
        bizPrices(businessId);
      }),
  );
  $("rescan").onclick = async () => {
    $("rescan").disabled = true;
    $("rescanState").hidden = false;
    $("rescanState").innerHTML = '<p class="loading" style="padding:0">Reading your documents…</p>';
    const { ok, data: out } = await api(`businesses/${businessId}/rescan`, { method: "POST" });
    $("rescan").disabled = false;
    if (!ok) return;
    toast(
      out.queued === 0
        ? "No documents to read."
        : `Reading ${out.queued} document${out.queued === 1 ? "" : "s"}. The first is done; the rest finish in the background.`,
    );
    bizPrices(businessId);
  };
}

/**
 * What the assistant reads before it answers.
 *
 * The upload reports "indexed" separately from "stored", because the index
 * accepts a write and can answer from it a little later. During that half
 * minute a document exists and is unfindable, which is exactly when an operator
 * tests it, so the page says which of the two has happened.
 */
async function bizDocuments(businessId, b) {
  $("bizTab").innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Documents</h2>
        <button class="btn btn-primary btn-sm" id="pickDoc">Upload</button>
        <input type="file" id="docFile" hidden accept=".pdf,.txt,.md,.csv,.json,.docx">
      </div>
      <div id="docState" hidden class="pad" style="padding-bottom:0"></div>
      ${
        (b.documents ?? []).length === 0
          ? `<div class="empty"><h3>No documents yet</h3>
               <p>A price list, a policy, a menu, an FAQ. The agent answers from these and says it does not
                  know when they do not cover the question, rather than guessing.</p></div>`
          : `<table><thead><tr><th>File</th><th>Status</th><th>Pieces</th><th>Added</th><th></th></tr></thead>
             <tbody>${b.documents
               .map(
                 (d) => `<tr><td><b>${h(d.filename)}</b>
                     <div style="color:var(--muted);font-size:12px">${h(d.contentType)}</div></td>
                   <td>${
                     d.status === "ready"
                       ? '<span class="tag green">Ready</span>'
                       : d.error
                         ? `<span class="tag amber">Failed</span> <span style="color:var(--muted)">${h(d.error)}</span>`
                         : `<span class="tag">${h(d.status)}</span>`
                   }</td>
                   <td>${num(d.chunkCount)}</td>
                   <td style="color:var(--muted)">${h(ago(d.createdAt))}</td>
                   <td style="text-align:right"><a href="#" data-doc="${h(d.id)}"
                     style="color:var(--muted);font-size:12.5px">Remove</a></td></tr>`,
               )
               .join("")}</tbody></table>`
      }
    </div>`;

  $("pickDoc").onclick = () => $("docFile").click();
  $("docFile").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    const box = $("docState");
    box.hidden = false;
    box.innerHTML = `<p class="loading" style="padding:0">Reading ${h(file.name)} and indexing it…</p>`;
    const { ok, data } = await api(`businesses/${businessId}/documents`, {
      method: "POST",
      raw: true,
      body: file,
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-filename": file.name.replace(/[^\x20-\x7e]/g, "_"),
      },
    });
    if (!ok) {
      box.innerHTML = `<p style="margin:0;color:var(--red)">${h(data.message || "That file could not be read.")}</p>`;
      return;
    }
    toast(
      data.searchable
        ? `Added. ${data.chunks} pieces, and the agent can already find them.`
        : `Stored in ${data.chunks} pieces. The index catches up in about half a minute.`,
    );
    businessDetail(businessId);
  };
  $("bizTab").querySelectorAll("[data-doc]").forEach(
    (a) =>
      (a.onclick = async (e) => {
        e.preventDefault();
        const choice = await ask("Remove this document", "The agent stops answering from it immediately.", [
          { key: "yes", label: "Remove", primary: true },
        ]);
        if (!choice) return;
        await api(`businesses/${businessId}/documents/${a.dataset.doc}`, { method: "DELETE" });
        businessDetail(businessId);
      }),
  );
}

async function bizWebsite(businessId) {
  const { ok, data } = await api(`businesses/${businessId}/web`);
  if (!ok) {
    $("bizTab").innerHTML =
      '<div class="card empty"><h3>No website channel</h3><p>This business was created without one.</p></div>';
    return;
  }
  const c = data.channel;
  $("bizTab").innerHTML = `
    <div class="grid g2">
      <div class="card">
        <div class="card-head"><h2>The widget</h2>
          <label style="display:flex;gap:7px;align-items:center;font-size:13px;font-weight:600">
            <input type="checkbox" id="webOn" ${c.enabled ? "checked" : ""}> On</label></div>
        <div class="pad">
          <div class="field"><label>Title</label><input id="wTitle" value="${h(c.title)}" maxlength="60"></div>
          <div class="field"><label>First thing it says</label>
            <input id="wGreeting" value="${h(c.greeting)}" maxlength="300"
              placeholder="Hello. Ask me anything about our prices or opening hours."></div>
          <div class="field"><label>Colour</label>
            <div style="display:flex;gap:9px;align-items:center">
              <input type="color" id="wAccent" value="${h(c.accent)}" style="width:46px;padding:3px">
              <input id="wAccentText" value="${h(c.accent)}" style="flex:1">
            </div></div>
          <div class="field" style="margin-bottom:0"><label>Sites allowed to show it</label>
            <input id="wOrigins" value="${h(c.allowedOrigins)}" placeholder="https://yourshop.com, https://www.yourshop.com">
            <small>Comma separated. Leave it empty and any site can embed it, which is fine while you are
              testing and not what you want afterwards. The daily cap is ${num(c.dailyLimit)} messages either way.</small></div>
          <div style="display:flex;gap:8px;margin-top:16px;align-items:center">
            <button class="btn btn-primary btn-sm" id="saveWeb">Save</button>
            <span id="webSaved" style="font-size:12.5px;color:var(--green)"></span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Put it on your site</h2></div>
        <div class="pad">
          <p style="color:var(--muted);font-size:13px;margin:0 0 12px">One line, before the closing
            <code>&lt;/body&gt;</code> tag of every page you want it on.</p>
          ${
            data.snippet === ""
              ? `<p style="margin:0;color:var(--muted)">This deployment has not recorded its own public address
                   yet, so the line cannot be written. It records it the first time anything reaches it there.</p>`
              : `<pre id="snippet">${h(data.snippet)}</pre>
                 <button class="btn btn-ghost btn-sm" id="copySnippet" style="margin-top:11px">Copy</button>`
          }
          <p style="color:var(--muted);font-size:12.5px;margin:14px 0 0">The key in that line is public by
            nature: it sits in a script tag on a page anyone can read. What protects the channel is the list
            of allowed sites and the daily cap, not the key being secret.</p>
        </div>
      </div>
    </div>`;

  $("webOn").onchange = async (e) => {
    await api(`businesses/${businessId}/web`, { method: "PATCH", body: { enabled: e.target.checked } });
    state.overview = null;
    toast(e.target.checked ? "Widget on." : "Widget off.");
  };
  $("wAccent").oninput = (e) => ($("wAccentText").value = e.target.value);
  $("wAccentText").oninput = (e) => {
    if (/^#[0-9a-f]{6}$/i.test(e.target.value)) $("wAccent").value = e.target.value;
  };
  $("saveWeb").onclick = async () => {
    $("saveWeb").disabled = true;
    const { ok: saved } = await api(`businesses/${businessId}/web`, {
      method: "PATCH",
      body: {
        title: $("wTitle").value,
        greeting: $("wGreeting").value,
        accent: $("wAccentText").value,
        allowedOrigins: $("wOrigins").value,
      },
    });
    $("saveWeb").disabled = false;
    if (!saved) return;
    $("webSaved").textContent = "Saved";
    setTimeout(() => ($("webSaved").textContent = ""), 2500);
  };
  if ($("copySnippet"))
    $("copySnippet").onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.snippet);
        toast("Copied.");
      } catch {
        // A browser that refuses the clipboard is not a failure worth a red
        // message: the line is on screen and can be selected.
        toast("Select the line and copy it.");
      }
    };
}


async function loadModels() {
  if (state.models.length > 0) return state.models;
  const { data } = await api("models");
  state.models = data.models ?? [];
  return state.models;
}

// ------------------------------------------------------------------ settings

async function viewSettings() {
  const { ok, data } = await api("system");
  if (!ok) return viewOutdated();
  const v = data.version ?? {};
  const tab = state.settingsTab;
  $("view").innerHTML = `
    <div class="subnav">
      <button data-stab="general" class="${tab === "general" ? "on" : ""}">General</button>
      <button data-stab="deployment" class="${tab === "deployment" ? "on" : ""}">Deployment</button>
      <button data-stab="security" class="${tab === "security" ? "on" : ""}">Security</button>
    </div>
    <div id="stab"></div>`;
  $("view").querySelectorAll("[data-stab]").forEach(
    (b) => (b.onclick = () => ((state.settingsTab = b.dataset.stab), viewSettings())),
  );

  const box = $("stab");
  if (tab === "general") {
    box.innerHTML = `
      <div class="card" style="max-width:640px">
        <div class="card-head"><h2>This deployment</h2></div>
        <div class="pad">
          <div class="field"><label>Address</label><input value="${h(worker)}" readonly></div>
          <div class="field"><label>Public origin it tells Telegram about</label>
            <input value="${h(data.origin || "not recorded yet")}" readonly></div>
          <div class="field" style="margin-bottom:0"><label>Source repository</label>
            <input value="${h(data.repo || "unknown")}" readonly></div>
        </div>
      </div>
      <div class="card" style="max-width:640px;margin-top:16px">
        <div class="card-head"><h2>Language</h2></div>
        <div class="pad">
          <p style="color:var(--muted);font-size:13px;margin:0 0 12px">The language you read the console in.
            It does not change the language your agents answer customers in; they follow whoever wrote to them.</p>
          <div class="field" style="max-width:320px;margin:0">
            <select id="uiLocale"></select>
          </div>
        </div>
      </div>
      <div class="card" style="max-width:640px;margin-top:16px">
        <div class="card-head"><h2>Usage today</h2></div>
        <div class="pad" style="display:flex;gap:34px">
          <div><div style="color:var(--muted);font-size:12.5px">Messages</div>
            <div style="font-size:22px;font-weight:700">${num(data.usage?.messages)}</div></div>
          <div><div style="color:var(--muted);font-size:12.5px">Input tokens</div>
            <div style="font-size:22px;font-weight:700">${num(data.usage?.inputTokens)}</div></div>
          <div><div style="color:var(--muted);font-size:12.5px">Output tokens</div>
            <div style="font-size:22px;font-weight:700">${num(data.usage?.outputTokens)}</div></div>
        </div>
      </div>`;
    const locales = await api("locale");
    if (locales.ok && $("uiLocale")) {
      state.locale = locales.data.locale ?? "en";
      $("uiLocale").innerHTML = (locales.data.available ?? [])
        .map(
          (l) => `<option value="${h(l.code)}" ${l.code === state.locale ? "selected" : ""}>${h(l.label)}</option>`,
        )
        .join("");
      $("uiLocale").onchange = async (e) => {
        const { ok: saved } = await api("locale", { method: "PUT", body: { locale: e.target.value } });
        if (saved) {
          state.locale = e.target.value;
          toast("Language changed.");
        }
      };
    }
    return;
  }

  if (tab === "deployment") {
    box.innerHTML = `
      <div class="card" style="max-width:700px">
        <div class="card-head"><h2>Version</h2></div>
        <div class="pad">
          <div id="versionNow">${versionBlock(v, data.repo ?? "")}</div>
          <div class="field" style="max-width:420px;margin:0 0 14px">
            <label>Where it pushes the new code</label>
            <div style="display:flex;gap:8px">
              <input id="srcRepo" placeholder="your-name/muxel" value="${h(data.sourceRepo ?? "")}" style="flex:1">
              <button class="btn btn-ghost btn-sm" id="saveRepo">Save</button>
            </div>
            <small>${
              data.sourceRepo
                ? "Your own copy on GitHub, the one Cloudflare builds from. The build worked this out on its own; change it only if it is wrong."
                : "The build could not work this out, so the update has nowhere to push. It is the repository Cloudflare builds this deployment from, as owner/name."
            }</small>
          </div>
          <button class="btn btn-sm ${v.behind ? "btn-primary" : "btn-ghost"}" id="doUpdate"
            ${data.githubToken && data.sourceRepo ? "" : "disabled"}>Update now</button>
          ${
            data.githubToken
              ? ""
              : '<p style="color:var(--muted);font-size:13px;margin:12px 0 0">Add a GitHub token under Security first.</p>'
          }
          ${
            data.sourceRepo
              ? ""
              : '<p style="color:var(--muted);font-size:13px;margin:12px 0 0">And say which repository it pushes to.</p>'
          }
          <div id="updateOut" style="margin-top:14px"></div>
        </div>
      </div>

      <!--
        Whether the owner's own copy is public. Read from GitHub with the token
        already stored, and changed on GitHub, because a button here that could
        flip it would need a token that could also delete the repository.
      -->
      <div class="card" style="max-width:700px;margin-top:16px">
        <div class="card-head"><h2>Your repository</h2></div>
        <div class="pad" id="repoPrivacy"><p class="loading" style="padding:0">Asking GitHub…</p></div>
      </div>`;
    $("saveRepo").onclick = async () => {
      const value = $("srcRepo").value.trim();
      if (!value) return;
      $("saveRepo").disabled = true;
      const { ok: saved } = await api("source-repo", { method: "PUT", body: { repo: value } });
      $("saveRepo").disabled = false;
      if (saved) {
        toast("Saved.");
        viewSettings();
      }
    };
    $("doUpdate").onclick = () => runUpdate(v.running);
    drawRepoPrivacy();
    return;
  }

  box.innerHTML = `
    <div class="card" style="max-width:700px">
      <div class="card-head"><h2>GitHub token</h2></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 14px">
          Used only to push the new code into your own repository. It is sealed with your deployment's own
          master key and kept in your own Cloudflare KV. This console cannot read it back, and neither can we:
          there is no server of ours in the path.</p>
        ${
          data.githubToken
            ? `<p style="margin:0 0 14px">A token is set. <a href="#" id="delTok">Remove it</a></p>`
            : ""
        }
        <div class="field" style="margin:0">
          <label>${data.githubToken ? "Replace the token" : "Add a token"}</label>
          <div style="display:flex;gap:8px">
            <input id="tok" type="password" placeholder="github_pat_… or ghp_…" autocomplete="off" style="flex:1">
            <button class="btn btn-primary btn-sm" id="saveTok">Save</button></div>
          ${data.githubToken ? keyLine(data.keyHint?.github_token ?? "") : ""}
          <small>Make a fine grained token on GitHub with <b>Contents: read and write</b> on your Muxel
            repository only. It is checked against GitHub before it is stored.</small>
        </div>
      </div>
    </div>

    <div class="card" style="max-width:700px;margin-top:16px">
      <div class="card-head"><h2>Cloudflare read access</h2></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 14px">
          One read only token, and this deployment can show you what each answer costs against your daily
          neuron allowance, and put your account's name on your own badge. We cannot make this token for
          you: Cloudflare does not let a Worker create an API token for the account it runs in, and it is
          right not to. You make it once.</p>
        ${
          data.cloudflare
            ? `<p style="margin:0 0 14px">Connected to
                 <b>${h(data.cloudflare.account || data.cloudflare.accountId)}</b>.
                 <a href="#" id="delCf">Remove it</a></p>`
            : ""
        }
        <div class="field" style="margin:0">
          <label>${data.cloudflare ? "Replace the token" : "Add a token"}</label>
          <div style="display:flex;gap:8px">
            <input id="cfTok" type="password" placeholder="Cloudflare API token" autocomplete="off" style="flex:1">
            <button class="btn btn-primary btn-sm" id="saveCf">Save</button></div>
          ${data.cloudflare ? keyLine(data.keyHint?.cloudflare_token ?? "") : ""}
          <small>On
            <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">
              Cloudflare → My Profile → API Tokens</a>, create a custom token with
            <b>Account Analytics: Read</b> and <b>Account Settings: Read</b>, scoped to the account this
            deployment runs in. Nothing here can write. You are not asked for an account id: the token
            belongs to one, and we ask Cloudflare which.</small>
        </div>
      </div>
    </div>

    ${state.apiRevision < NEEDS.outside ? "" : `
    <div class="card" style="max-width:700px;margin-top:16px">
      <div class="card-head"><h2>Web search</h2></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 14px">
          Your assistant answers from your own material, and that is the point of it. This is the one
          exception, and it is only ever <b>yours</b>: with a SerpApi key it can look up what something
          sells for elsewhere and who sells it, who else is on the map near you, and what a page says.
          Your customers' agents never use it — they answer from your material or hand over to you.</p>
        ${outsidePanel({
          on: data.outside?.webSearch === true,
          hint: data.keyHint?.serpapi_key ?? "",
          id: "serp",
          placeholder: "SerpApi key",
          leaves: "Only the words you search for, from your Worker to SerpApi.",
          where: `Your key is on <a href="https://serpapi.com/manage-api-key" target="_blank"
                  rel="noopener">serpapi.com → Your Account → API Key</a>. It is checked against
                  SerpApi before it is stored, and this deployment can never show it back to you.`,
        })}
      </div>
    </div>

    <div class="card" style="max-width:700px;margin-top:16px">
      <div class="card-head"><h2>Document data</h2></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 14px">
          A price list you upload is read as prose today, and a model that reads prose is just as fluent
          when it is wrong. With a Nutrient DWS key your assistant can read the original file as rows
          instead, each with a confidence — so it can tell you which three of forty to check, instead of
          handing you forty that all look equally certain. Nothing it reads is saved: every row is still
          a card you tap Yes on.</p>
        ${outsidePanel({
          on: data.outside?.documentData === true,
          hint: data.keyHint?.nutrient_key ?? "",
          id: "nut",
          placeholder: "Nutrient DWS key",
          leaves: "The file itself, from your Worker to Nutrient, when you ask for a document to be read.",
          where: `Make an account at <a href="https://dashboard.nutrient.io" target="_blank"
                  rel="noopener">dashboard.nutrient.io</a> — every account starts with free credits — and
                  copy the API key. It is checked before it is stored, and never shown back to you.`,
        })}
      </div>
    </div>`}

    <div class="card" style="max-width:700px;margin-top:16px">
      <div class="card-head"><h2>Console bot</h2></div>
      <div class="pad">
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 14px">The Telegram bot that is your private
          control panel. It is never the bot your customers write to. Replacing it here detaches the old one
          and points the new one at this deployment.</p>
        <div class="field" style="margin:0">
          <label>Move the console to a different bot</label>
          <div style="display:flex;gap:8px">
            <input id="consoleBotToken" type="password" placeholder="123456:ABC-DEF…" autocomplete="off" style="flex:1">
            <button class="btn btn-ghost btn-sm" id="saveConsoleBot">Move</button></div>
          <small>From @BotFather, and not the token of a bot that answers customers. Sealed with your
            deployment's own key before it is stored.</small>
        </div>
      </div>
    </div>`;
  $("saveConsoleBot").onclick = async () => {
    const value = $("consoleBotToken").value.trim();
    if (!value) return;
    const choice = await ask(
      "Move the console to a different bot",
      "The bot you are using now stops being the console immediately, and the new one takes over. Make sure you can already message the new one.",
      [{ key: "yes", label: "Move it", primary: true }],
    );
    if (!choice) return;
    $("saveConsoleBot").disabled = true;
    const { ok: moved, data: out } = await api("console-bot", { method: "POST", body: { token: value } });
    $("saveConsoleBot").disabled = false;
    if (moved) {
      $("consoleBotToken").value = "";
      toast(`The console is now @${out.username}.`);
    }
  };

  // Drawn only on a deployment whose API has the routes behind them. A button
  // that 404s is worse than no button: it reads as the deployment being broken
  // rather than as a version that has not arrived yet.
  for (const [id, name] of state.apiRevision < NEEDS.outside
    ? []
    : [["serp", "serpapi_key"], ["nut", "nutrient_key"]]) {
    $(`save-${id}`).onclick = async () => {
      const value = $(`key-${id}`).value.trim();
      if (!value) return;
      $(`save-${id}`).disabled = true;
      const { ok: saved, data: out } = await api(`secrets/${name}`, { method: "PUT", body: { token: value } });
      $(`save-${id}`).disabled = false;
      // Two different noes. The service refusing the key is something the owner
      // can fix by pasting a different one; anything else is not, and telling
      // them to check the key they just checked would send them the wrong way.
      if (!saved) return toast(out?.detail ? `Not saved: ${out.detail}.` : "That key was not saved.");
      toast("Saved. Your assistant can use it from the next message.");
      // The assistant's own prompt reads the same vault, so what it will say it
      // can do has just changed too.
      state.health = null;
      viewSettings();
    };
    if ($(`del-${id}`))
      $(`del-${id}`).onclick = async (e) => {
        e.preventDefault();
        await api(`secrets/${name}`, { method: "DELETE" });
        state.health = null;
        viewSettings();
      };
  }

  $("saveCf").onclick = async () => {
    const value = $("cfTok").value.trim();
    if (!value) return;
    $("saveCf").disabled = true;
    const { ok: saved, data: out } = await api("secrets/cloudflare_token", {
      method: "PUT",
      body: { token: value },
    });
    $("saveCf").disabled = false;
    if (!saved) return toast("Cloudflare would not accept that token.");
    toast(out.account ? `Connected to ${out.account}.` : "Connected.");
    // The badge and the cost lines both read from this, so both are stale now.
    state.health = null;
    viewSettings();
    whoAmI();
  };
  if ($("delCf"))
    $("delCf").onclick = async (e) => {
      e.preventDefault();
      await api("secrets/cloudflare_token", { method: "DELETE" });
      viewSettings();
    };

  $("saveTok").onclick = async () => {
    const value = $("tok").value.trim();
    if (!value) return;
    $("saveTok").disabled = true;
    const { ok: saved, data: out } = await api("secrets/github_token", { method: "PUT", body: { token: value } });
    $("saveTok").disabled = false;
    if (saved) {
      toast(`Saved${out.login ? ` for ${out.login}` : ""}.`);
      viewSettings();
    }
  };
  if ($("delTok"))
    $("delTok").onclick = async (e) => {
      e.preventDefault();
      await api("secrets/github_token", { method: "DELETE" });
      viewSettings();
    };
}

/**
 * Whether the owner's own copy of the code is public, and what that means.
 *
 * Making it private is one click, on GitHub. It is not a button here because
 * changing a repository's visibility needs Administration rights, and a
 * deployment holding a token with those could also delete the repository — a
 * heavy thing to store in order to flip one bit. The console reads the state
 * with the token it already has and says what is true.
 */
async function drawRepoPrivacy() {
  const box = $("repoPrivacy");
  if (box === null) return;
  const { ok, data } = await api("source-repo");
  if (!ok || !data.repo) {
    box.innerHTML = '<p style="margin:0;color:var(--muted);font-size:13.5px">This deployment does not know which repository it was built from, so there is nothing to check.</p>';
    return;
  }
  const shared = `<p style="margin:10px 0 0;color:var(--muted);font-size:13px">
      Nothing secret is in it either way. Your bot tokens and keys are Cloudflare secrets, and your
      customers are in your own D1 — none of that is in the repository. What is in it is the code,
      your worker's name and the ids of your D1 and KV. Updates work exactly the same when it is
      private, because they use the token you already gave this console.</p>`;
  if (data.private === true) {
    box.innerHTML = `<p style="margin:0;color:var(--green)"><b>${h(data.repo)} is private.</b></p>${shared}`;
    return;
  }
  if (data.private === null) {
    box.innerHTML = `<p style="margin:0;color:var(--muted);font-size:13.5px">
        GitHub did not say whether <b>${h(data.repo)}</b> is public or private. Add a token under
        Security, or check it on GitHub.</p>`;
    return;
  }
  box.innerHTML = `
    <p style="margin:0 0 6px"><b>${h(data.repo)} is public.</b></p>
    <p style="margin:0;color:var(--muted);font-size:13.5px">Anyone can see it. Making it private takes
      one click on GitHub and changes nothing here.</p>
    ${shared}
    <a class="btn btn-primary btn-sm" style="margin-top:14px" target="_blank" rel="noopener"
       href="${h(data.url)}">Make it private on GitHub</a>
    <button class="btn btn-ghost btn-sm" style="margin-top:14px" id="repoRecheck">I have done it</button>`;
  $("repoRecheck").onclick = () => {
    box.innerHTML = '<p class="loading" style="padding:0">Asking GitHub…</p>';
    drawRepoPrivacy();
  };
}

/**
 * What version this deployment is on, and whether that is the newest.
 *
 * Its own function because two things draw it: the panel when it opens, and the
 * update while it watches. They used to be two readings of the same fact, and
 * the older one stayed on screen — so a bar reading "your deployment is running
 * 0.21.0, 100%" sat directly under a line still saying "Running 0.20.1 · an
 * update is available". One of them was always wrong.
 */
const versionBlock = (v, repo) => `
  <p style="color:var(--muted);font-size:13.5px;margin:0 0 13px">
    Running <b style="color:var(--ink)">${h(v.running ?? "unknown")}</b>${
      v.latest ? ` · latest is <b style="color:var(--ink)">${h(v.latest)}</b>` : ""
    }${repo ? ` · from <b style="color:var(--ink)">${h(repo)}</b>` : ""}</p>
  ${
    v.behind
      ? `<p style="margin:0 0 14px;color:var(--brand-ink)"><b>An update is available.</b> One click copies
           the new code into your own GitHub repository. Cloudflare builds and deploys it from there, so
           nothing of ours ever touches your account.</p>`
      : '<p style="margin:0 0 14px;color:var(--muted)">This deployment is up to date.</p>'
  }`;

/** Repaints that line from a reading the update just took. */
/**
 * The field for one key to a service outside this deployment.
 *
 * One renderer for both, because they are the same shape and the same promise:
 * the key is yours, it is checked before it is kept, it is never shown back,
 * and the panel says in plain words what leaves your account when it is set.
 * Two hand written copies of that is two places for the promise to drift.
 */
/**
 * Which key is stored, written the way a card number is on a receipt.
 *
 * One renderer for every credential section, because "a token is set" does not
 * tell an owner whether the right one is set, and four hand-written versions
 * of that line is four places for the promise around it to drift.
 *
 * Never the key. The mask is computed by the deployment when the key is saved
 * and stored beside it; nothing here, and nothing on the way here, opens the
 * envelope. A key stored before the deployment kept that record has no mask to
 * show, and says so rather than leaving a gap that reads as "no key".
 */
function keyLine(hint) {
  return `<div class="key-hint">Saved <code>${h(hint || "\u2022".repeat(10))}</code>${
    hint ? "" : " — saved before this deployment kept a record of which key. Paste it again to see it here."
  }</div>`;
}

function outsidePanel(panel) {
  return `
    ${
      panel.on
        ? `<p class="on-note">This is on. <a href="#" id="del-${panel.id}">Turn it off and forget the key</a></p>`
        : ""
    }
    <div class="field" style="margin:0">
      <label>${panel.on ? "Replace the key" : "Add a key"}</label>
      <div style="display:flex;gap:8px">
        <input id="key-${panel.id}" type="password" placeholder="${h(panel.placeholder)}" autocomplete="off"
          style="flex:1">
        <button class="btn btn-primary btn-sm" id="save-${panel.id}">Save</button></div>
      ${panel.on ? keyLine(panel.hint) : ""}
      <small><b>What leaves your account:</b> ${h(panel.leaves)} Nothing reaches us — this page is talking
        to your own deployment. ${panel.where}</small>
    </div>`;
}

function paintVersion(version, repo) {
  const box = $("versionNow");
  if (box === null || version === undefined) return;
  box.innerHTML = versionBlock(version, repo);
  const button = $("doUpdate");
  if (button !== null) {
    button.classList.toggle("btn-primary", Boolean(version.behind));
    button.classList.toggle("btn-ghost", !version.behind);
  }
}

/**
 * Pushes the update, then watches for it to land.
 *
 * The old version said "give it a couple of minutes, then reload", which asks
 * the owner to guess. The deployment reports the version it is running, so the
 * console can simply watch that: when it changes to the one that was pushed,
 * the new code is live and it says so.
 *
 * The bar reaches the end only on that observation. Cloudflare does not report
 * how far through a build it is and neither does this, so the middle stretch
 * creeps and is labelled as waiting rather than as measuring. It stops short of
 * the end until the deployment itself answers with a new version.
 */
const UPDATE_POLL_MS = 5_000;
/** After this, Cloudflare has had long enough that silence is worth saying. */
const UPDATE_PATIENCE_MS = 6 * 60_000;

async function runUpdate(runningBefore) {
  const out = $("updateOut");
  $("doUpdate").disabled = true;
  drawProgress(6, "Reading the new code and pushing it to your repository");

  const { data: pushed } = await api("update", { method: "POST" });
  if (!pushed.ok) {
    $("doUpdate").disabled = false;
    out.innerHTML =
      `<p style="margin:0;color:var(--red)">${h(pushed.message ?? "That did not work.")}</p>` +
      (pushed.notes ?? []).map(updateNote).join("");
    return;
  }

  // The version upstream is the one this push is bringing. When the deployment
  // starts reporting it, Cloudflare has finished.
  const expect = String(pushed.expect ?? "");
  const observable = expect.length > 0 && expect !== runningBefore;
  drawProgress(30, "Cloudflare is building your deployment", pushed.notes ?? []);

  const started = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, UPDATE_POLL_MS));
    const waited = Date.now() - started;
    const { ok, data } = await api("system", { quiet: true });
    const running = data?.version?.running;
    if (ok) paintVersion(data.version, data.repo ?? "");

    if (ok && observable && running === expect) {
      drawProgress(100, `Your deployment is running ${h(expect)}`);
      out.insertAdjacentHTML(
        "beforeend",
        '<button class="btn btn-primary btn-sm" id="updateReload" style="margin-top:14px">Reload the console</button>',
      );
      $("updateReload").onclick = () => location.reload();
      return;
    }

    if (waited > UPDATE_PATIENCE_MS) {
      // Not a failure, and not a success either. Cloudflare may still be
      // building, or this release may not have changed the version number, in
      // which case nothing here can ever see it land.
      drawProgress(
        95,
        observable
          ? "Cloudflare is taking longer than usual. It may still be building."
          : "Pushed. This release did not change the version number, so this page cannot tell when it lands.",
      );
      out.insertAdjacentHTML(
        "beforeend",
        '<button class="btn btn-ghost btn-sm" id="updateReload" style="margin-top:14px">Reload and check</button>',
      );
      $("updateReload").onclick = () => location.reload();
      return;
    }

    // Creeping, not measuring: it approaches the end without arriving, because
    // arriving is a thing only the deployment can tell us.
    drawProgress(
      30 + Math.round(62 * (1 - Math.exp(-waited / 90_000))),
      "Cloudflare is building your deployment",
      pushed.notes ?? [],
    );
  }
}

function drawProgress(percent, label, notes = []) {
  $("updateOut").innerHTML = `
    <div class="bar" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
      <span style="width:${percent}%"></span></div>
    <p class="bar-label">${h(label)}<b>${percent}%</b></p>
    ${notes.map(updateNote).join("")}`;
}

const updateNote = (note) => `<p style="margin:10px 0 0;padding:11px 14px;background:var(--brand-soft);
  border:1px solid var(--brand-line);border-radius:10px;font-size:13px;color:var(--brand-ink)">${h(note)}</p>`;

// ------------------------------------------------------------------ advanced

/**
 * The screens the Telegram console bot has, laid out for a desk.
 *
 * These are generated by the deployment, not by this page: one function there
 * returns a title, some prose and rows of buttons, and it is the only place
 * that knows how to upload a document, edit a prompt or read a customer's
 * remembered facts. So the content is theirs and untouched, including every
 * button in the order they sent it. Dropping their Back button because this
 * page has a breadcrumb would be this page editing their screen.
 *
 * What changes is the presentation. The destinations from the top screen become
 * a rail, so a phone's one-question-at-a-time flow gains somewhere to stand; the
 * title comes out of the prose and becomes a heading; and each row of buttons is
 * a row of chips sized to its label rather than a stack of full width pills.
 */
async function viewAdvanced() {
  $("view").innerHTML = `
    <p style="margin:0 0 14px"><a href="#" id="backToDiag" style="color:var(--muted);font-size:13px">← Diagnostics</a></p>
    <div class="split">
      <div class="card list" id="advNav">${waitingMark()}</div>
      <div class="card" id="advPane">${waitingMark()}</div>
    </div>`;
  $("backToDiag").onclick = (e) => (e.preventDefault(), go("diagnostics"));
  if (state.advNav === null) {
    // The top screen is the deployment's own list of destinations, in the
    // operator's own language. Asking it once beats naming them here, where
    // they would go stale the moment the bot grows a screen.
    const home = await screenCall("home", []);
    if (home === null) return;
    state.advNav = (home.rows ?? []).flat();
    state.advHome = home;
  }
  drawAdvNav();
  if (state.advTrail.length === 0) {
    state.advTrail = [{ action: "home", args: [], label: "Console" }];
    drawScreen(state.advHome);
  } else {
    const at = state.advTrail[state.advTrail.length - 1];
    const fresh = await screenCall(at.action, at.args);
    if (fresh !== null) drawScreen(fresh);
  }
}

function drawAdvNav() {
  const nav = $("advNav");
  if (!nav) return;
  const here = state.advTrail[0]?.action ?? "home";
  nav.innerHTML =
    `<div class="it ${here === "home" ? "on" : ""}" data-action="home" data-args="[]">
       <div class="grow"><b>Console</b><small>the top screen</small></div></div>` +
    state.advNav
      .map(
        (b) => `<div class="it ${here === b.action ? "on" : ""}"
          data-action="${h(b.action)}" data-args="${h(JSON.stringify(b.args ?? []))}">
          <div class="grow"><b>${h(b.text)}</b></div></div>`,
      )
      .join("");
  nav.querySelectorAll(".it").forEach((it) => {
    it.onclick = () => {
      state.advTrail = [{ action: it.dataset.action, args: JSON.parse(it.dataset.args), label: it.querySelector("b").textContent }];
      openScreen(it.dataset.action, JSON.parse(it.dataset.args));
    };
  });
}

/** Asks the deployment for a screen. Returns null and says so on a failure. */
async function screenCall(action, args = [], answer) {
  let response;
  try {
    response = await fetch(`${worker}/admin/screen`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, args, ...(answer ? { answer } : {}) }),
    });
  } catch {
    toast("Could not reach your deployment. Check that it is still live.");
    return null;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(data.message || "That action could not complete.");
    return null;
  }
  // A screen may have changed the world the other tabs are showing.
  state.overview = null;
  return data;
}

async function openScreen(action, args = [], answer) {
  const data = await screenCall(action, args, answer);
  if (data === null) return;
  // The rail IS the top screen's rows, so a top screen that has grown a button
  // updates it. Caching them once and never looking again is how a rail comes
  // to disagree with the deployment it is a picture of.
  if (action === "home") {
    state.advNav = (data.rows ?? []).flat();
    state.advHome = data;
  }
  drawScreen(data);
  drawAdvNav();
}

/** The title is the first bold line of the screen's own text. */
function splitScreenText(text) {
  const match = /^\s*<b>([\s\S]*?)<\/b>\s*/.exec(text ?? "");
  return match === null
    ? { title: "", body: text ?? "" }
    : { title: match[1], body: (text ?? "").slice(match[0].length).replace(/^\n+/, "") };
}

function drawScreen(data) {
  const pane = $("advPane");
  if (!pane) return;
  const { title, body } = splitScreenText(data.text);
  const trail = state.advTrail;
  const atHome = trail.length === 1 && trail[0].action === "home";

  pane.innerHTML = `
    <div class="card-head" style="display:block">
      ${
        trail.length > 1
          ? `<div style="font-size:12px;color:var(--muted);margin-bottom:5px">${trail
              .map((step, i) =>
                i === trail.length - 1
                  ? `<span>${h(step.label)}</span>`
                  : `<a href="#" data-crumb="${i}">${h(step.label)}</a> <span style="opacity:.5">›</span> `,
              )
              .join("")}</div>`
          : ""
      }
      <h2 style="font-size:16px">${title === "" ? "Console" : title}</h2>
    </div>
    <div class="pad">
      ${body.trim() === "" ? "" : `<div class="screen-body">${body}</div>`}
      ${
        atHome
          ? `<p style="margin:14px 0 0;color:var(--muted);font-size:13px">Every screen this bot has is listed
              beside this one, exactly as it sends them. Nearly all of it now has a page of its own in the
              console; this stays because a screen the bot grows tomorrow appears here the same day, and
              because it is the same control panel you can reach from your phone.</p>`
          : ""
      }
      ${
        data.pending
          ? `<form id="screenSay" class="answer-row">
              <input id="screenAnswer" autocomplete="off" spellcheck="false"
                type="${data.pending.secret ? "password" : "text"}"
                placeholder="${data.pending.secret ? "Paste it here" : "Type your answer and press enter"}">
              <button class="btn btn-primary btn-sm" type="submit">Send</button>
            </form>
            ${
              data.pending.secret
                ? `<p class="answer-note">This is a credential, so it is typed hidden and never shown back.
                     Sent straight to your deployment, sealed there with its own key. In the Telegram console
                     the same answer is deleted from the chat the moment it arrives.</p>`
                : ""
            }`
          : ""
      }
      <div id="screenRows" style="display:flex;flex-direction:column;gap:8px;margin-top:${
        (body.trim() === "" && !data.pending) || atHome ? "0" : "16px"
      }"></div>
    </div>`;

  const rows = $("screenRows");
  // On the top screen the rows and the rail are the same list. Drawing them
  // twice on one page is not more information, it is the same information in
  // two places. Nothing is hidden: every one of them is beside this, clickable.
  for (const row of atHome ? [] : (data.rows ?? [])) {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    for (const button of row) {
      const el = document.createElement("button");
      el.className = "btn btn-ghost btn-sm";
      el.textContent = button.text;
      el.onclick = () => {
        state.advTrail = [...state.advTrail, { action: button.action, args: button.args ?? [], label: button.text }];
        openScreen(button.action, button.args ?? []);
      };
      line.appendChild(el);
    }
    rows.appendChild(line);
  }

  pane.querySelectorAll("[data-crumb]").forEach(
    (a) =>
      (a.onclick = (e) => {
        e.preventDefault();
        const at = Number(a.dataset.crumb);
        state.advTrail = state.advTrail.slice(0, at + 1);
        const step = state.advTrail[at];
        openScreen(step.action, step.args);
      }),
  );

  if (data.pending) {
    $("screenSay").onsubmit = (e) => {
      e.preventDefault();
      const value = $("screenAnswer").value.trim();
      if (value) openScreen("answer", [], value);
    };
    $("screenAnswer").focus();
  }
}

// ------------------------------------------------------------------ outdated

/**
 * What a page says when the deployment has not caught up with it.
 *
 * Named plainly, because the operator has done nothing wrong and nothing is
 * broken: this console is simply newer than the code they are running, and one
 * button fixes it. The pages that do work are still listed, so the answer is
 * never "come back later" with nothing to do in the meantime.
 */
function viewNeedsUpdate(view, needs) {
  const label = (TITLES[view] ?? ["This page"])[0];
  // Pages only. NEEDS is the one table of what needs which revision, and not
  // every entry in it is somewhere the owner can go: naming a Settings panel
  // in a list of pages that still work would send them looking for it in the
  // rail.
  const working = Object.entries(NEEDS)
    .filter(([id, level]) => level <= state.apiRevision && id !== view && TITLES[id] !== undefined)
    .map(([id]) => TITLES[id][0]);
  $("view").innerHTML = `
    <div class="card" style="padding:24px;max-width:720px;margin-bottom:16px">
      <h2 style="margin:0 0 8px;font-size:17px">${h(label)} needs your deployment updated</h2>
      <p style="margin:0 0 13px;color:var(--ink-2)">This console has moved on ahead of the code your
        deployment is running. Nothing is broken and nothing has been lost; this page just asks your
        deployment questions it does not know how to answer yet.</p>
      <p style="margin:0 0 16px;color:var(--muted);font-size:13.5px">Your deployment speaks version
        ${state.apiRevision} of the console API. This page needs ${needs}.</p>
      <button class="btn btn-primary btn-sm" id="toUpdate">Update your deployment</button>
    </div>
    ${
      working.length === 0
        ? ""
        : `<div class="card" style="padding:20px 24px;max-width:720px">
             <p style="margin:0;color:var(--muted);font-size:13.5px">Working in the meantime:
               ${working.map((name) => h(name)).join(", ")}.</p></div>`
    }`;
  $("toUpdate").onclick = () => {
    state.settingsTab = "deployment";
    go("settings");
  };
}

function viewOutdated() {
  $("view").innerHTML = `
    <div class="card" style="padding:24px;max-width:760px;margin-bottom:16px">
      <h2 style="margin:0 0 8px;font-size:17px">This browser cannot reach your deployment</h2>
      <p style="margin:0 0 13px;color:var(--ink-2)">Your deployment is running and answering customers
        normally. The problem is only between it and this page: builds from before the web console existed
        answer the browser's permission check with an error, so the browser refuses every call this page
        makes. Not some of them, all of them, which is why nothing here has anything in it.</p>
      <p style="margin:0 0 14px;color:var(--ink-2)"><b>Your Telegram console bot still does everything.</b>
        Businesses, conversations, documents, the price list, your GitHub token and the update itself are
        all there and unaffected. Nothing has been lost.</p>
    </div>
    <div class="card" style="padding:24px;max-width:760px;border-color:var(--brand-line);background:var(--brand-soft)">
      <h3 style="margin:0 0 8px;font-size:16px;color:var(--brand-ink)">Do not press Update in the bot yet</h3>
      <p style="margin:0 0 12px">The update in your current build copies every file from upstream, and that
        includes <code>wrangler.jsonc</code>, the file naming your Worker and the database holding your
        conversations. Upstream's copy has placeholders in those places, so running that update would point
        this deployment at a database that does not exist. Nothing would be deleted, and nothing would be
        able to find it either.</p>
      <p style="margin:0">That is fixed upstream, and the fix cannot be fetched by the thing it fixes.
        One sync that leaves <code>wrangler.jsonc</code> alone repairs both this page and the update button
        at the same time: <code>scripts/first-sync.sh</code>, once. Nothing needs deleting or redeploying,
        and your database, bots and conversations stay exactly where they are.</p>
    </div>`;
}

// ------------------------------------------------------------------- palette

let paletteEl = null;
function openPalette() {
  if (paletteEl) return;
  const bg = document.createElement("div");
  bg.className = "palette-bg";
  bg.innerHTML = `<div class="palette">
    <input id="pq" placeholder="Search businesses, customers and messages…" autocomplete="off">
    <div class="out" id="pout"></div></div>`;
  document.body.appendChild(bg);
  paletteEl = bg;
  const close = () => (bg.remove(), (paletteEl = null));
  bg.onclick = (e) => e.target === bg && close();
  const input = bg.querySelector("#pq");
  input.focus();

  const pages = ALL_VIEWS;
  const draw = (results) => {
    const out = bg.querySelector("#pout");
    const term = input.value.trim().toLowerCase();
    const matched = pages.filter((p) => p.label.toLowerCase().includes(term));
    out.innerHTML =
      (matched.length > 0
        ? `<div class="grp">GO TO</div>` +
          matched.map((p) => `<div class="hit" data-go="${p.id}">${icon(p.id, 15)}${h(p.label)}</div>`).join("")
        : "") +
      (results?.businesses?.length
        ? `<div class="grp">BUSINESSES</div>` +
          results.businesses.map((b) => `<div class="hit" data-biz="${h(b.id)}">${h(b.name)}</div>`).join("")
        : "") +
      (results?.customers?.length
        ? `<div class="grp">CUSTOMERS</div>` +
          results.customers
            .map(
              (c) => `<div class="hit" data-cust="${h(c.id)}">${h(c.name || "Someone")}<small>${h(c.businessName)}</small></div>`,
            )
            .join("")
        : "") +
      (results?.messages?.length
        ? `<div class="grp">MESSAGES</div>` +
          results.messages
            .map(
              (m) => `<div class="hit" ${m.customerId ? `data-cust="${h(m.customerId)}"` : ""}>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h(m.content.slice(0, 70))}</span>
                <small>${h(m.businessName)}</small></div>`,
            )
            .join("")
        : "");
    out.querySelectorAll("[data-go]").forEach((el) => (el.onclick = () => (close(), go(el.dataset.go))));
    out.querySelectorAll("[data-biz]").forEach(
      (el) => (el.onclick = () => (close(), go("businesses", { businessId: el.dataset.biz }))),
    );
    out.querySelectorAll("[data-cust]").forEach(
      (el) => (el.onclick = () => (close(), go("messages", { customerId: el.dataset.cust }))),
    );
  };
  draw(null);

  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    const term = input.value.trim();
    if (term.length < 2) return draw(null);
    timer = setTimeout(async () => {
      const { ok, data } = await api(`search?q=${encodeURIComponent(term)}`, { quiet: true });
      draw(ok ? data : null);
    }, 180);
  };
  bg.addEventListener("keydown", (e) => e.key === "Escape" && close());
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (worker && token) openPalette();
  }
});

// --------------------------------------------------------------------- theme

const themeNow = () => document.documentElement.getAttribute("data-theme") ?? "light";
function applyTheme(name) {
  document.documentElement.setAttribute("data-theme", name);
  try {
    localStorage.setItem(THEME, name);
  } catch {
    /* a browser with storage switched off still gets the theme for this visit */
  }
}
function toggleTheme() {
  applyTheme(themeNow() === "dark" ? "light" : "dark");
  shell();
  render();
}

// ------------------------------------------------------------------- dialogs

/** A question with named answers. Resolves to the chosen key, or null. */
function ask(title, body, choices) {
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal">
      <h3>${h(title)}</h3><p class="sub">${h(body)}</p>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-key="">Cancel</button>
        ${choices
          .map(
            (c) => `<button class="btn ${c.primary ? "btn-primary" : "btn-ghost"} btn-sm" data-key="${h(c.key)}">${h(c.label)}</button>`,
          )
          .join("")}
      </div></div>`;
    bg.onclick = (e) => {
      if (e.target === bg) return bg.remove(), resolve(null);
      const key = e.target.dataset?.key;
      if (key !== undefined) (bg.remove(), resolve(key || null));
    };
    document.body.appendChild(bg);
  });
}

/** The profile fields, in the order they are asked for and shown. */
const PROFILE_FIELDS = [
  ["kind", "What kind of business", "Bakery · Clinic · Moving company", false],
  ["about", "In a sentence or two", "Family bakery in Thonglor since 2014. Everything baked the same morning.", true],
  ["address", "Address", "12 Sukhumvit Road, Watthana, Bangkok 10110", false],
  ["mapUrl", "Google Maps link", "https://maps.app.goo.gl/…", false],
  ["hours", "Opening hours", "Mon to Sat, 7am to 7pm. Closed Sunday.", false],
  ["phone", "Phone", "02 123 4567", false],
  ["email", "Email", "hello@sunrisebakery.co.th", false],
  ["facebook", "Facebook page", "https://facebook.com/sunrisebakery", false],
  ["website", "Website", "https://sunrisebakery.co.th", false],
];

const profileInputs = (values = {}) =>
  PROFILE_FIELDS.map(([id, label, placeholder, wide]) =>
    wide
      ? `<div class="field" style="grid-column:1/-1"><label>${label}</label>
           <textarea id="pf_${id}" rows="2" placeholder="${h(placeholder)}">${h(values[id] ?? "")}</textarea></div>`
      : `<div class="field"><label>${label}</label>
           <input id="pf_${id}" placeholder="${h(placeholder)}" value="${h(values[id] ?? "")}"></div>`,
  ).join("");

const readProfileInputs = (root) =>
  Object.fromEntries(PROFILE_FIELDS.map(([id]) => [id, root.querySelector(`#pf_${id}`).value]));

/**
 * Making a business: what it is, how to reach it, and where it answers.
 *
 * Three boxes, because they are three different kinds of answer. The first two
 * are facts about the shop, which the assistant is told plainly and which stay
 * editable as fields afterwards. The third is a decision about this deployment,
 * and it is separate and required, because a business that answers nowhere is
 * the one thing this is not for.
 *
 * Everything but the name can be left blank and filled in later. Nothing here
 * is invented on the owner's behalf: a field left empty is a field the
 * assistant is not told about, and it says it does not know rather than
 * guessing.
 */
function createBusinessDialog() {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal wide">
    <h3>Create a business</h3>
    <p class="sub">Only the name is needed. Everything else can wait, and the more you give it the fewer
      questions it has to hand to you.</p>

    <div class="box">
      <b class="box-title">The business</b>
      <div class="field"><label>Name <span class="req">required</span></label>
        <input id="bizName" placeholder="Sunrise Bakery" autocomplete="off"></div>
      <div class="two">${profileInputs()}</div>
    </div>

    <div class="box">
      <b class="box-title">Where it answers <span class="req">choose one</span></b>
      <p class="box-note">A business answers customers somewhere. Pick one now; the other can be added
        later from its page.</p>
      <div class="picks">
        <label class="pick"><input type="radio" name="chan" value="web" checked>
          <div><b>My website</b><small>A chat bubble on your own pages. Nothing else needed, and you get
            the one line to paste as soon as this is made.</small></div></label>
        <label class="pick"><input type="radio" name="chan" value="telegram">
          <div><b>Telegram</b><small>Customers message a bot you own. Send <code>/newbot</code> to
            @BotFather and paste the token it gives you.</small></div></label>
      </div>
      <div id="tokBox" hidden style="margin-top:12px">
        <div class="field" style="margin-bottom:8px"><label>Telegram bot token</label>
          <input id="bizToken" type="password" placeholder="123456:ABC-DEF…" autocomplete="off">
          <small>Sealed with your deployment's own key and stored in your own Cloudflare account.</small></div>
        <label class="check"><input type="checkbox" id="useBotName">
          <span>The bot and the business have the same name. Use the bot's name and ignore what I typed
            above.</span></label>
      </div>
    </div>

    <div class="box">
      <b class="box-title">Your price list and documents <span class="opt">optional</span></b>
      <p class="box-note">A price list, a menu, a policy. PDF, Word, Excel, CSV, text. The assistant answers
        from these and says it does not know when they do not cover the question. They upload once the
        business exists, and you can add more any time.</p>
      <input type="file" id="bizDocs" multiple accept=".pdf,.txt,.md,.csv,.json,.docx,.xlsx,.xls">
      <div id="docNames" class="box-note"></div>
    </div>

    <div class="actions">
      <button class="btn btn-ghost btn-sm" id="cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="create">Create</button>
    </div>
    <div id="bizProgress" class="box-note" style="text-align:right"></div>
  </div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector("#cancel").onclick = close;
  bg.onclick = (e) => e.target === bg && close();
  bg.querySelector("#bizName").focus();

  bg.querySelectorAll('input[name="chan"]').forEach((radio) => {
    radio.onchange = () => {
      bg.querySelector("#tokBox").hidden = bg.querySelector('input[name="chan"]:checked').value !== "telegram";
    };
  });
  bg.querySelector("#bizDocs").onchange = (e) => {
    const names = [...e.target.files].map((f) => f.name);
    bg.querySelector("#docNames").textContent =
      names.length === 0 ? "" : `Will upload: ${names.join(", ")}`;
  };

  const say = (text) => (bg.querySelector("#bizProgress").textContent = text);

  const submit = async () => {
    const name = bg.querySelector("#bizName").value.trim();
    if (!name) {
      say("Give it a name first.");
      bg.querySelector("#bizName").focus();
      return;
    }
    const channel = bg.querySelector('input[name="chan"]:checked').value;
    const botToken = bg.querySelector("#bizToken").value.trim();
    if (channel === "telegram" && !botToken) {
      say("Paste the bot token, or choose your website instead.");
      return;
    }
    bg.querySelector("#create").disabled = true;

    say("Creating…");
    const { ok, data } = await api("businesses", {
      method: "POST",
      body: { name, profile: readProfileInputs(bg) },
    });
    if (!ok) {
      bg.querySelector("#create").disabled = false;
      return say("");
    }

    // The business exists from here on. Every step after this reports its own
    // outcome, because a bot that was refused or a file that would not parse
    // must not read as the whole thing having failed.
    let note = `${name} created.`;
    if (channel === "telegram") {
      say("Attaching the bot…");
      const attached = await api(`businesses/${data.id}/telegram`, {
        method: "POST",
        body: { token: botToken, useBotName: bg.querySelector("#useBotName").checked },
      });
      note += attached.ok ? " It is answering on Telegram." : " The bot token was refused, so it is not on Telegram yet.";
    } else {
      note += " It is answering on your website.";
    }

    const files = [...bg.querySelector("#bizDocs").files];
    let failed = 0;
    for (const [index, file] of files.entries()) {
      say(`Reading ${file.name} (${index + 1} of ${files.length})…`);
      const uploaded = await api(`businesses/${data.id}/documents`, {
        method: "POST",
        raw: true,
        body: file,
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-filename": file.name.replace(/[^\x20-\x7e]/g, "_"),
        },
      });
      if (!uploaded.ok) failed += 1;
    }
    if (files.length > 0) {
      note +=
        failed === 0
          ? ` ${files.length} document${files.length === 1 ? "" : "s"} read.`
          : ` ${files.length - failed} of ${files.length} documents read; the rest could not be.`;
    }

    close();
    state.overview = null;
    state.bizTab = "overview";
    toast(note);
    go("businesses", { businessId: data.id });
  };
  bg.querySelector("#create").onclick = submit;
  bg.querySelector("#bizName").onkeydown = (e) => {
    if (e.key === "Enter") submit();
  };
}

/**
 * An agent is a business answering somewhere, so this picks the business and
 * the somewhere. It never creates a business: a business is a real thing with
 * a price list and customers, and making one as a side effect of setting up a
 * channel is how you end up with two of them by accident.
 *
 * With none to choose from it says so and hands over to the page that makes
 * them, rather than growing a second way to make one.
 */
async function createAgentDialog(preselect) {
  const d = await overview(true);
  const businesses = d.businesses ?? [];

  const bg = document.createElement("div");
  bg.className = "modal-bg";
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.onclick = (e) => e.target === bg && close();

  if (businesses.length === 0) {
    bg.innerHTML = `<div class="modal">
      <h3>You need a business first</h3>
      <p class="sub">An agent answers <b>for</b> something: a shop, a clinic, a studio. Make that first and
        this takes about ten seconds afterwards.</p>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" id="cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="toBiz">Create your business</button>
      </div></div>`;
    bg.querySelector("#cancel").onclick = close;
    bg.querySelector("#toBiz").onclick = () => {
      close();
      go("businesses");
      createBusinessDialog();
    };
    return;
  }

  const chosen = () => businesses.find((b) => b.id === bg.querySelector("#agBiz").value);
  bg.innerHTML = `<div class="modal">
    <h3>Set up an agent</h3>
    <p class="sub">An agent is one of your businesses answering somewhere. Pick which, and where.</p>
    <div class="field"><label>Business</label>
      <div style="display:flex;gap:8px">
        <select id="agBiz" style="flex:1">${businesses
          .map(
            (b) => `<option value="${h(b.id)}" ${b.id === preselect ? "selected" : ""}>${h(b.name)}</option>`,
          )
          .join("")}</select>
        <button type="button" class="icon-btn" id="agNewBiz" title="Add a new business"
          style="width:40px;height:40px;flex:none">${icon("plus", 17)}</button>
      </div>
      <div id="agHas" style="margin-top:7px"></div></div>
    <div class="field"><label>Where should it answer?</label>
      <select id="agWhere"></select></div>
    <div class="field" id="agTokRow" hidden><label>Telegram bot token</label>
      <input id="agToken" type="password" placeholder="123456:ABC-DEF…" autocomplete="off">
      <small>Send <code>/newbot</code> to @BotFather and paste what it gives you. It is sealed with your
        deployment's own key and stored in your own Cloudflare account.</small></div>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" id="cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="go">Set it up</button>
    </div></div>`;
  bg.querySelector("#cancel").onclick = close;
  // The picker lists what exists; this is how a new one comes to exist, and it
  // leads to the page that makes them rather than making one here. Setting up a
  // channel and creating a shop stay two different acts however you arrive.
  bg.querySelector("#agNewBiz").onclick = () => {
    close();
    go("businesses");
    createBusinessDialog();
  };

  const refresh = () => {
    const b = chosen();
    const has = [];
    if (b.telegram) has.push(`<span class="tag blue">Telegram · @${h(b.telegram.username)}</span>`);
    if (b.web?.enabled) has.push('<span class="tag brand">Website widget on</span>');
    bg.querySelector("#agHas").innerHTML =
      has.length > 0
        ? `<span style="font-size:12.5px;color:var(--muted)">Already answering: </span>${has.join(" ")}`
        : '<span style="font-size:12.5px;color:var(--muted)">Not answering anywhere yet.</span>';

    // Only what this business does not already have. An option that would do
    // nothing is worse than a shorter list.
    const options = [];
    if (!b.telegram) options.push(["telegram", "Telegram · I have a bot token"]);
    if (!b.web?.enabled) options.push(["web", "My website · nothing else needed"]);
    const where = bg.querySelector("#agWhere");
    if (options.length === 0) {
      where.innerHTML = '<option value="">It already answers everywhere it can</option>';
      where.disabled = true;
      bg.querySelector("#go").disabled = true;
      bg.querySelector("#agTokRow").hidden = true;
      return;
    }
    where.disabled = false;
    bg.querySelector("#go").disabled = false;
    where.innerHTML = options.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
    bg.querySelector("#agTokRow").hidden = where.value !== "telegram";
  };
  refresh();
  bg.querySelector("#agBiz").onchange = refresh;
  bg.querySelector("#agWhere").onchange = (e) =>
    (bg.querySelector("#agTokRow").hidden = e.target.value !== "telegram");

  bg.querySelector("#go").onclick = async () => {
    const b = chosen();
    const where = bg.querySelector("#agWhere").value;
    const button = bg.querySelector("#go");
    if (where === "telegram") {
      const token = bg.querySelector("#agToken").value.trim();
      if (!token) return toast("Paste the bot token, or choose the website instead.");
      button.disabled = true;
      const { ok } = await api(`businesses/${b.id}/telegram`, { method: "POST", body: { token } });
      if (!ok) return (button.disabled = false);
      toast(`${b.name} is answering on Telegram now.`);
    } else {
      button.disabled = true;
      const { ok } = await api(`businesses/${b.id}`, { method: "PATCH", body: { webEnabled: true } });
      if (!ok) return (button.disabled = false);
      toast(`${b.name} is answering on your website now.`);
    }
    close();
    state.overview = null;
    state.bizTab = "overview";
    go("businesses", { businessId: b.id });
  };
}

/** One dialog for adding and for correcting, because they are one write. */
function productDialog(businessId, item) {
  const editing = item != null;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">
    <h3>${editing ? "Correct this item" : "Add to the price list"}</h3>
    <p class="sub">${
      editing && item.source
        ? `Read out of ${h(item.source)}. What you put here overrides it, and survives that file being read again.`
        : "The agent quotes from this list and nowhere else."
    }</p>
    <div class="field"><label>Item</label>
      <input id="pName" placeholder="Chocolate cake, 1 lb" value="${editing ? h(item.name) : ""}"></div>
    <div class="field"><label>Price</label>
      <input id="pPrice" placeholder="450 THB" value="${editing ? h(item.price) : ""}"></div>
    <div class="field"><label>Description</label>
      <input id="pDesc" placeholder="Serves 6 to 8. Order a day ahead." value="${editing ? h(item.description) : ""}"></div>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" id="cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="save">${editing ? "Save" : "Add"}</button>
    </div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector("#cancel").onclick = close;
  bg.onclick = (e) => e.target === bg && close();
  bg.querySelector("#pName").focus();
  bg.querySelector("#save").onclick = async () => {
    const name = bg.querySelector("#pName").value.trim();
    if (!name) return;
    bg.querySelector("#save").disabled = true;
    const body = {
      name,
      price: bg.querySelector("#pPrice").value,
      description: bg.querySelector("#pDesc").value,
    };
    const { ok } = editing
      ? await api(`businesses/${businessId}/products/${encodeURIComponent(item.key)}`, {
          method: "PATCH",
          body,
        })
      : await api(`businesses/${businessId}/products`, { method: "POST", body });
    if (!ok) return (bg.querySelector("#save").disabled = false);
    close();
    bizPrices(businessId);
  };
}

// ------------------------------------------------------------------- connect

/**
 * The one place that decides which of the three screens is on.
 *
 * Boot is on until this runs, so a reload of a connected console never paints
 * the sign-in page on its way to the console.
 *
 * It does not take boot down itself. Taking it down here put the console's own
 * frame on screen — rail, header, an empty content area — with a second and
 * differently shaped loading mark inside it, while the first view was still
 * being fetched. That is two loading screens for one page load, in the order
 * that makes the second one look like something went wrong. The sign-in screen
 * has nothing to fetch and ends boot as soon as it is up; the console ends it
 * once it has actually drawn a view.
 */
function showConsole(on) {
  $("onboardingWrap").hidden = on;
  $("shell").hidden = !on;
  if (on) {
    shell();
    render();
  } else {
    booted();
  }
}

/** Boot is over, because something real is now behind it. */
function booted() {
  const booting = $("boot");
  if (booting) booting.hidden = true;
}

/**
 * The mark, waiting, inside a page that is already drawn.
 *
 * For moving between views once the console is up. The first view of a page
 * load happens behind the boot screen, so this is never the thing an owner
 * sees while the console is still arriving.
 */
function waitingMark(what = "Loading") {
  return `<div class="loading-mark"><img src="/assets/logo.png" alt="">${h(what)}</div>`;
}

function disconnect(event) {
  event?.preventDefault();
  localStorage.removeItem(KEY);
  localStorage.removeItem(TOK);
  worker = "";
  token = "";
  clearInterval(state.poll);
  Object.assign(state, {
    api: null, overview: null, health: null, businessId: null, customerId: null,
    chats: null, chatId: null, chatModel: null, assistant: null,
  });
  showConsole(false);
}

/**
 * Checks that an address is a Muxel deployment, from the browser.
 *
 * This used to be a call to our own server, which then made the request. That
 * needed an SSRF guard, because a server fetching a URL a stranger typed can be
 * pointed at things on its own network. A browser fetching a URL its own owner
 * typed is just that person opening their own deployment, so the guard and the
 * server both go away.
 */
async function probe(url) {
  const base = url.replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(12000) });
    const body = await response.json().catch(() => ({}));
    if (body?.service !== "muxel") {
      return { ok: false, message: "That URL answered, but it is not a Muxel deployment." };
    }
    return { ok: true, base, status: body.status ?? "unknown" };
  } catch {
    return {
      ok: false,
      message: "Could not reach that address. Check the URL, and that the deployment is live.",
    };
  }
}

$("connectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("workerUrl").value.trim();
  if (!url) return;
  $("connectBtn").disabled = true;
  $("connectErr").classList.remove("on");
  const result = await probe(url);
  $("connectBtn").disabled = false;
  if (!result.ok) {
    $("connectErr").textContent = result.message;
    $("connectErr").classList.add("on");
    return;
  }
  worker = result.base;
  localStorage.setItem(KEY, worker);
  // Reaching it is not the same as being allowed into it, so the code comes next.
  $("step2").hidden = false;
  $("pairCode").focus();
});

$("pairForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("pairCode").value.trim().toUpperCase();
  if (!code) return;
  $("pairBtn").disabled = true;
  $("connectErr").classList.remove("on");
  const response = await fetch(`${worker}/admin/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await response.json().catch(() => ({}));
  $("pairBtn").disabled = false;
  if (!response.ok) {
    $("connectErr").textContent = data.message || "That code did not work.";
    $("connectErr").classList.add("on");
    return;
  }
  token = data.token;
  localStorage.setItem(TOK, token);
  showConsole(true);
});

try {
  applyTheme(
    localStorage.getItem(THEME) ??
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
} catch {
  applyTheme("light");
}
showConsole(Boolean(worker && token));
