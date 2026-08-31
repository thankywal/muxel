/**
 * The Muxel console.
 *
 * The first version of this page rendered the Telegram screens as they came:
 * one question at a time, a Back button where navigation should be, and a grid
 * of buttons standing in for a layout. That is right on a phone and wrong at a
 * desk, where an operator has a price list to load, a hundred conversations to
 * read and two things to compare at once.
 *
 * So this asks the deployment for facts and lays itself out. The business logic
 * is not written twice: the same queries answer both consoles, and only the
 * presentation differs, which is the part that should. The Telegram screens are
 * still reachable under Advanced, because they cover ground this page does not
 * yet, and hiding them would be pretending otherwise.
 *
 * Nothing here is stored on the server that served the page. The deployment's
 * address and the token live in this browser and are sent with each request.
 */
const $ = (id) => document.getElementById(id);
const KEY = "muxel.worker";
const TOK = "muxel.token";
let worker = localStorage.getItem(KEY) || "";
let token = localStorage.getItem(TOK) || "";

/** Everything from the deployment is escaped. It is the operator's data, not ours. */
const h = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  tab: "home",
  businessId: null,
  customerId: null,
  overview: null,
  models: [],
  conversation: null,
  poll: null,
};

/** One door onto the deployment's data API. */
async function api(path, options = {}) {
  const response = await fetch(`/api/w/${path}`, {
    method: options.method ?? "GET",
    headers: {
      "x-muxel-worker": worker,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined && !options.raw ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: options.raw ? options.body : JSON.stringify(options.body) }),
  });
  if (options.blob) {
    return { ok: response.ok, status: response.status, data: response.ok ? await response.blob() : null };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) toast(data.message || data.error || "That did not work.");
  return { ok: response.ok, status: response.status, data };
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

const ago = (iso) => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const nameOf = (customer) =>
  customer.displayName || (customer.username ? `@${customer.username}` : "Someone");

// ---------------------------------------------------------------- navigation

function go(tab, next = {}) {
  clearInterval(state.poll);
  state.poll = null;
  state.tab = tab;
  if (next.businessId !== undefined) state.businessId = next.businessId;
  if (next.customerId !== undefined) state.customerId = next.customerId;
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("on", n.dataset.tab === tab));
  render();
}

function render() {
  const view = $("view");
  view.innerHTML = '<p class="loading">Loading…</p>';
  ({ home: viewHome, agents: viewAgents, businesses: viewBusinesses, settings: viewSettings, advanced: viewAdvanced }[
    state.tab
  ] ?? viewHome)();
}

/** The overview is the source for both Home and the Agents list. */
async function overview(force = false) {
  if (state.overview && !force) return state.overview;
  const { data } = await api("overview");
  state.overview = data;
  return data;
}

// --------------------------------------------------------------------- cards

const channelChips = (b) => {
  const chips = [];
  if (b.telegram) {
    chips.push(
      `<span class="chip tg ${b.telegram.enabled ? "" : "off"}"><span class="d"></span>Telegram · @${h(
        b.telegram.username,
      )}</span>`,
    );
  }
  if (b.web) {
    chips.push(`<span class="chip web ${b.web.enabled ? "" : "off"}"><span class="d"></span>Website</span>`);
  }
  if (chips.length === 0) chips.push('<span class="chip off"><span class="d"></span>No channel yet</span>');
  return chips.join("");
};

const agentCard = (b) => `
  <div class="agent" data-business="${h(b.id)}">
    <h3>${h(b.name)}</h3>
    <div class="sub">${h(b.modelLabel)}</div>
    <div class="chips">${channelChips(b)}</div>
    <div class="row3">
      <div><b>${b.usage.messages}</b>messages today</div>
      <div><b>${b.customers}</b>customers</div>
      <div><b>${(b.usage.inputTokens + b.usage.outputTokens).toLocaleString()}</b>tokens today</div>
    </div>
  </div>`;

// ---------------------------------------------------------------------- home

async function viewHome() {
  const data = await overview();
  const businesses = data.businesses ?? [];
  const totals = data.totals ?? {};
  $("view").innerHTML = `
    <div class="page-head">
      <div><h1>Your agents</h1><p>What they answered today, and who they answered.</p></div>
      <button class="btn btn-primary btn-sm" id="newBiz">Create agent</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">Agents</div><div class="v">${totals.businesses ?? 0}</div></div>
      <div class="stat"><div class="k">Live channels</div><div class="v">${totals.agents ?? 0}</div></div>
      <div class="stat"><div class="k">Messages today</div><div class="v">${totals.messagesToday ?? 0}</div></div>
      <div class="stat"><div class="k">Customers</div><div class="v">${totals.customers ?? 0}</div></div>
    </div>
    ${
      businesses.length === 0
        ? `<div class="empty">
             <h3>Nothing is answering yet</h3>
             <p>An agent is a business plus the channels it answers on. Create one, teach it your
                price list, and point a Telegram bot or your website at it.</p>
             <button class="btn btn-primary" id="newBiz2">Create your first agent</button>
           </div>`
        : `<div class="cards">${businesses.map(agentCard).join("")}</div>`
    }
    ${
      (data.events ?? []).length === 0
        ? ""
        : `<h2 style="font-size:14px;letter-spacing:.06em;color:var(--muted);margin:30px 0 12px">RECENT ACTIVITY</h2>
           <table><tbody>${data.events
             .map(
               (e) => `<tr style="cursor:default"><td style="width:150px;color:var(--muted)">${h(ago(e.createdAt))}</td>
                 <td style="width:170px">${h(e.businessName ?? "—")}</td>
                 <td><b>${h(e.kind)}</b> <span class="muted">${h(e.detail)}</span></td></tr>`,
             )
             .join("")}</tbody></table>`
    }`;
  $("view")
    .querySelectorAll(".agent")
    .forEach((card) => (card.onclick = () => go("agents", { businessId: card.dataset.business, customerId: null })));
  for (const id of ["newBiz", "newBiz2"]) if ($(id)) $(id).onclick = createBusinessDialog;
}

// -------------------------------------------------------------------- agents

async function viewAgents() {
  const data = await overview();
  const businesses = data.businesses ?? [];
  if (businesses.length === 0) return viewHome();
  if (!state.businessId || !businesses.some((b) => b.id === state.businessId)) {
    state.businessId = businesses[0].id;
  }
  const current = businesses.find((b) => b.id === state.businessId);

  $("view").innerHTML = `
    <div class="page-head">
      <div><h1>${h(current.name)}</h1><p>${channelChips(current)}</p></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px" id="agentTabs">
      ${businesses
        .map(
          (b) =>
            `<button class="btn btn-sm ${b.id === state.businessId ? "btn-primary" : "btn-ghost"}"
               data-business="${h(b.id)}">${h(b.name)}</button>`,
        )
        .join("")}
    </div>
    <div class="split">
      <div class="list" id="convList"><p class="loading" style="padding:0 15px">Loading…</p></div>
      <div id="convPane"></div>
    </div>`;
  $("agentTabs")
    .querySelectorAll("button")
    .forEach((b) => (b.onclick = () => go("agents", { businessId: b.dataset.business, customerId: null })));
  loadCustomers();
}

async function loadCustomers() {
  const { data } = await api(`businesses/${state.businessId}/customers`);
  const customers = data.customers ?? [];
  const list = $("convList");
  if (!list) return;
  if (customers.length === 0) {
    list.innerHTML =
      '<div style="padding:26px 16px" class="muted">Nobody has written to this agent yet.</div>';
    $("convPane").innerHTML =
      '<div class="empty"><h3>No conversations</h3><p>They appear here the moment a customer sends the first message.</p></div>';
    return;
  }
  list.innerHTML = customers
    .map(
      (c) => `<div class="it ${c.id === state.customerId ? "on" : ""}" data-customer="${h(c.id)}">
        <b>${h(nameOf(c))}</b>
        <span>${c.messageCount} messages · ${h(ago(c.lastSeen))}</span>
      </div>`,
    )
    .join("");
  list.querySelectorAll(".it").forEach((it) => {
    it.onclick = () => {
      state.customerId = it.dataset.customer;
      list.querySelectorAll(".it").forEach((o) => o.classList.toggle("on", o === it));
      openConversation();
    };
  });
  if (!state.customerId || !customers.some((c) => c.id === state.customerId)) {
    state.customerId = customers[0].id;
    list.querySelector(".it")?.classList.add("on");
  }
  openConversation();
}

async function openConversation(quiet = false) {
  const { ok, data } = await api(`conversations/${state.customerId}`);
  if (!ok) return;
  state.conversation = data;
  drawConversation();
  if (!quiet) {
    clearInterval(state.poll);
    // A person watching a live chat expects it to move on its own. Eight
    // seconds is slow enough to cost nothing and fast enough that an operator
    // does not reach for a refresh button that is not there.
    state.poll = setInterval(() => {
      if (state.tab === "agents" && state.customerId) openConversation(true);
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
    <div class="chat">
      <div class="chat-head">
        <div>
          <b>${h(nameOf(customer))}</b>
          <span>${customer.username ? "@" + h(customer.username) + " · " : ""}${customer.messageCount} messages · ${h(
            ago(customer.lastSeen),
          )}</span>
        </div>
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
              </div>
            </div>`;
        })
        .join("")}</div>
      <form class="composer" id="say">
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
    box.innerHTML = `<span class="muted" style="font-size:12.5px">${h(box.dataset.kind)} · no longer available</span>`;
    return;
  }
  const url = URL.createObjectURL(data);
  box.innerHTML =
    data.type.startsWith("image/")
      ? `<img src="${url}" alt="${h(box.dataset.kind)}">`
      : data.type.startsWith("video/")
        ? `<video src="${url}" controls></video>`
        : `<a href="${url}" download class="muted" style="font-size:13px">Download the ${h(box.dataset.kind)}</a>`;
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
  const { ok, data } = await api(`conversations/${state.customerId}/send`, {
    method: "POST",
    body: { text },
  });
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
  // Said plainly, because the two outcomes are genuinely different and the
  // operator is the only one who can see which one they needed.
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
  loadCustomers();
}

// ---------------------------------------------------------------- businesses

async function viewBusinesses() {
  if (state.businessId && state.tab === "businesses" && state.detail) return businessDetail(state.businessId);
  const data = await overview();
  const businesses = data.businesses ?? [];
  $("view").innerHTML = `
    <div class="page-head">
      <div><h1>Businesses</h1><p>What each agent answers about, and where it answers.</p></div>
      <button class="btn btn-primary btn-sm" id="newBiz">Create business</button>
    </div>
    ${
      businesses.length === 0
        ? `<div class="empty"><h3>No businesses yet</h3>
             <p>A business is one assistant: one price list, one voice, and the channels it answers on.</p>
             <button class="btn btn-primary" id="newBiz2">Create your first business</button></div>`
        : `<table>
            <thead><tr><th>Name</th><th>Channels</th><th>Model</th><th>Today</th><th>Customers</th></tr></thead>
            <tbody>${businesses
              .map(
                (b) => `<tr data-business="${h(b.id)}">
                  <td><b>${h(b.name)}</b></td>
                  <td>${channelChips(b)}</td>
                  <td class="muted">${h(b.modelLabel)}</td>
                  <td>${b.usage.messages}</td>
                  <td>${b.customers}</td>
                </tr>`,
              )
              .join("")}</tbody></table>`
    }`;
  $("view")
    .querySelectorAll("tr[data-business]")
    .forEach((row) => (row.onclick = () => businessDetail(row.dataset.business)));
  for (const id of ["newBiz", "newBiz2"]) if ($(id)) $(id).onclick = createBusinessDialog;
}

async function businessDetail(businessId) {
  state.businessId = businessId;
  $("view").innerHTML = '<p class="loading">Loading…</p>';
  const [{ data: b }, models] = await Promise.all([api(`businesses/${businessId}`), loadModels()]);
  $("view").innerHTML = `
    <div class="page-head">
      <div>
        <a href="#" class="muted" id="back" style="font-size:13px">← All businesses</a>
        <h1 style="margin-top:6px">${h(b.name)}</h1>
        <p>${channelChips(b)}</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="delBiz">Delete business</button>
    </div>

    <div class="stats">
      <div class="stat"><div class="k">Messages today</div><div class="v">${b.usage.messages}</div></div>
      <div class="stat"><div class="k">Customers</div><div class="v">${b.customers}</div></div>
      <div class="stat"><div class="k">Products</div><div class="v">${(b.products ?? []).length}</div></div>
      <div class="stat"><div class="k">Documents</div><div class="v">${(b.documents ?? []).length}</div></div>
    </div>

    <div class="card" style="padding:22px;margin-bottom:18px">
      <h3 style="margin:0 0 4px;font-size:16px">Which model answers</h3>
      <p class="muted" style="margin:0 0 14px;font-size:13.5px">Every one of these runs inside your own
        Cloudflare account. A bigger model reads more before it answers and uses more of your daily allowance.</p>
      <div class="form-row" style="max-width:420px;margin:0">
        <select id="model">${models
          .map((m) => `<option value="${h(m.id)}" ${m.id === b.model ? "selected" : ""}>${h(m.label)}</option>`)
          .join("")}</select>
      </div>
    </div>

    <div class="card" style="padding:22px;margin-bottom:18px">
      <h3 style="margin:0 0 4px;font-size:16px">Channels</h3>
      <p class="muted" style="margin:0 0 14px;font-size:13.5px">Where customers reach this business.</p>
      ${
        b.telegram
          ? `<p style="margin:0 0 12px">Telegram · <b>@${h(b.telegram.username)}</b></p>`
          : `<div class="form-row" style="max-width:520px">
               <label>Attach a Telegram bot</label>
               <div style="display:flex;gap:9px">
                 <input id="botToken" placeholder="123456:ABC-DEF…" autocomplete="off" style="flex:1">
                 <button class="btn btn-primary btn-sm" id="attachBot">Attach</button>
               </div>
               <small>Create it with @BotFather, then paste the token it gives you. It is sealed
                 with your deployment's own key and stored in your own Cloudflare account.</small>
             </div>`
      }
      ${
        b.web
          ? `<label style="display:flex;gap:9px;align-items:center;margin-top:10px;font-size:14px">
               <input type="checkbox" id="webOn" ${b.web.enabled ? "checked" : ""}> Website widget is on
             </label>`
          : ""
      }
    </div>

    <div class="card" style="padding:22px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div>
          <h3 style="margin:0 0 4px;font-size:16px">Price list</h3>
          <p class="muted" style="margin:0;font-size:13.5px">The only prices the agent is allowed to quote.</p>
        </div>
        <button class="btn btn-ghost btn-sm" id="addProduct">Add item</button>
      </div>
      ${
        (b.products ?? []).length === 0
          ? '<p class="muted" style="margin:0">Nothing here yet, so the agent will say it does not know a price rather than invent one.</p>'
          : `<table><thead><tr><th>Item</th><th>Price</th><th>Description</th><th></th></tr></thead>
             <tbody>${b.products
               .map(
                 (p) => `<tr style="cursor:default"><td><b>${h(p.name)}</b></td><td>${h(p.price)}</td>
                   <td class="muted">${h(p.description)}</td>
                   <td style="text-align:right"><a href="#" class="muted" data-prod="${h(p.id)}">Remove</a></td></tr>`,
               )
               .join("")}</tbody></table>`
      }
    </div>

    <div class="card" style="padding:22px">
      <h3 style="margin:0 0 4px;font-size:16px">Documents</h3>
      <p class="muted" style="margin:0 0 14px;font-size:13.5px">What the agent reads before it answers.
        Upload from the console bot in Telegram, under Advanced.</p>
      ${
        (b.documents ?? []).length === 0
          ? '<p class="muted" style="margin:0">No documents yet.</p>'
          : `<table><thead><tr><th>File</th><th>Status</th><th>Pieces</th></tr></thead><tbody>${b.documents
              .map(
                (d) => `<tr style="cursor:default"><td>${h(d.filename)}</td>
                  <td>${h(d.status)}${d.error ? ` · <span class="muted">${h(d.error)}</span>` : ""}</td>
                  <td>${d.chunkCount}</td></tr>`,
              )
              .join("")}</tbody></table>`
      }
    </div>`;

  $("back").onclick = (e) => (e.preventDefault(), (state.businessId = null), go("businesses"));
  $("model").onchange = async (e) => {
    await api(`businesses/${businessId}`, { method: "PATCH", body: { model: e.target.value } });
    state.overview = null;
    toast("Model changed.");
  };
  if ($("webOn"))
    $("webOn").onchange = async (e) => {
      await api(`businesses/${businessId}`, { method: "PATCH", body: { webEnabled: e.target.checked } });
      state.overview = null;
      toast(e.target.checked ? "Website widget on." : "Website widget off.");
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
  $("addProduct").onclick = () => addProductDialog(businessId);
  $("view")
    .querySelectorAll("[data-prod]")
    .forEach(
      (a) =>
        (a.onclick = async (e) => {
          e.preventDefault();
          await api(`businesses/${businessId}/products/${a.dataset.prod}`, { method: "DELETE" });
          businessDetail(businessId);
        }),
    );
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

async function loadModels() {
  if (state.models.length > 0) return state.models;
  const { data } = await api("models");
  state.models = data.models ?? [];
  return state.models;
}

// ------------------------------------------------------------------ settings

async function viewSettings() {
  const { data } = await api("system");
  const v = data.version ?? {};
  $("view").innerHTML = `
    <div class="page-head">
      <div><h1>Settings</h1><p>What this deployment is running, and how it updates itself.</p></div>
    </div>

    <div class="card" style="padding:22px;margin-bottom:18px">
      <h3 style="margin:0 0 4px;font-size:16px">Version</h3>
      <p class="muted" style="margin:0 0 14px;font-size:13.5px">
        Running <b>${h(v.running ?? "unknown")}</b>${
          v.latest ? ` · latest is <b>${h(v.latest)}</b>` : ""
        } · from <b>${h(data.repo ?? "")}</b></p>
      ${
        v.behind
          ? `<p style="margin:0 0 14px;color:var(--orange-ink)"><b>An update is available.</b> One click copies the
               new code into your own GitHub repository. Cloudflare builds and deploys it from there, so nothing
               of ours ever touches your account.</p>`
          : '<p style="margin:0 0 14px" class="muted">This deployment is up to date.</p>'
      }
      <button class="btn ${v.behind ? "btn-primary" : "btn-ghost"} btn-sm" id="doUpdate"
        ${data.githubToken ? "" : "disabled"}>Update now</button>
      ${
        data.githubToken
          ? ""
          : '<p class="muted" style="margin:12px 0 0;font-size:13.5px">Add a GitHub token below before updating.</p>'
      }
      <div id="updateOut" style="margin-top:14px"></div>
    </div>

    <div class="card" style="padding:22px">
      <h3 style="margin:0 0 4px;font-size:16px">GitHub token</h3>
      <p class="muted" style="margin:0 0 14px;font-size:13.5px">
        Used only to push the new code into your own repository. It is sealed with your deployment's own
        master key and kept in your own Cloudflare KV. This console cannot read it back, and neither can we:
        there is no server of ours in the path.</p>
      ${
        data.githubToken
          ? `<p style="margin:0 0 14px">A token is set. <a href="#" id="delTok">Remove it</a></p>`
          : ""
      }
      <div class="form-row" style="max-width:560px;margin:0">
        <label>${data.githubToken ? "Replace the token" : "Add a token"}</label>
        <div style="display:flex;gap:9px">
          <input id="tok" type="password" placeholder="github_pat_… or ghp_…" autocomplete="off" style="flex:1">
          <button class="btn btn-primary btn-sm" id="saveTok">Save</button>
        </div>
        <small>Make a fine grained token on GitHub with <b>Contents: read and write</b> on your Muxel
          repository only. It is checked against GitHub before it is stored.</small>
      </div>
    </div>`;

  $("saveTok").onclick = async () => {
    const value = $("tok").value.trim();
    if (!value) return;
    $("saveTok").disabled = true;
    const { ok, data: out } = await api("secrets/github_token", { method: "PUT", body: { token: value } });
    $("saveTok").disabled = false;
    if (ok) {
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
  $("doUpdate").onclick = async () => {
    $("doUpdate").disabled = true;
    $("updateOut").innerHTML = '<p class="loading" style="padding:0">Reading the new code and pushing it…</p>';
    const { data: out } = await api("update", { method: "POST" });
    $("doUpdate").disabled = false;
    $("updateOut").innerHTML = `<p style="margin:0;color:${out.ok ? "#15803d" : "#b91c1c"}">${h(out.message)}</p>
      ${
        out.ok
          ? '<p class="muted" style="margin:8px 0 0;font-size:13.5px">Cloudflare builds and deploys it from your repository. Give it a couple of minutes, then reload.</p>'
          : ""
      }
      ${(out.notes ?? [])
        .map(
          (note) =>
            `<p style="margin:10px 0 0;padding:11px 14px;background:#fff7ed;border:1px solid #fed7aa;
              border-radius:11px;font-size:13.5px;color:var(--orange-ink)">${h(note)}</p>`,
        )
        .join("")}`;
  };
}

// ------------------------------------------------------------------ advanced

/**
 * The Telegram screens, as they are.
 *
 * Everything the console bot can do is here, including the parts this page has
 * no layout for yet: uploading a document, editing the prompt, a customer's
 * remembered facts. Keeping them reachable is more honest than a web app that
 * silently does less than the bot it replaces.
 */
async function viewAdvanced() {
  $("view").innerHTML = `
    <div class="page-head">
      <div><h1>Advanced</h1><p>Every screen the console bot has, including the ones this app has no page for yet:
        documents, the prompt, skills and a customer's remembered facts.</p></div>
    </div>
    <div class="card" style="padding:26px 28px;max-width:720px">
      <div id="screenText" style="font-size:15.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word"></div>
      <div id="screenRows" style="margin-top:20px;display:flex;flex-direction:column;gap:9px"></div>
      <form id="screenSay" style="display:none;gap:9px;margin-top:16px">
        <input id="screenAnswer" placeholder="Type your answer and press enter" autocomplete="off"
          style="flex:1;padding:11px 14px;border:1px solid var(--line);border-radius:11px;font:inherit">
        <button class="btn btn-primary btn-sm" type="submit">Send</button>
      </form>
    </div>`;
  $("screenSay").onsubmit = (e) => {
    e.preventDefault();
    const value = $("screenAnswer").value.trim();
    if (value) screen("answer", [], value);
  };
  screen("home", []);
}

async function screen(action, args = [], answer) {
  const response = await fetch("/api/screen", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ worker, action, args, ...(answer ? { answer } : {}) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return toast(data.message || "That action could not complete.");
  if (!$("screenText")) return;
  $("screenText").innerHTML = data.text ?? "";
  $("screenAnswer").value = "";
  const rows = $("screenRows");
  rows.innerHTML = "";
  for (const row of data.rows ?? []) {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;gap:9px;flex-wrap:wrap";
    for (const button of row) {
      const el = document.createElement("button");
      el.className = "btn btn-ghost btn-sm";
      el.textContent = button.text;
      el.onclick = () => screen(button.action, button.args ?? []);
      line.appendChild(el);
    }
    rows.appendChild(line);
  }
  $("screenSay").style.display = data.pending ? "flex" : "none";
  // A screen that has changed the world behind this page invalidates what the
  // other tabs are showing, so they are re fetched rather than trusted.
  state.overview = null;
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
            (c) =>
              `<button class="btn ${c.primary ? "btn-primary" : "btn-ghost"} btn-sm" data-key="${h(
                c.key,
              )}">${h(c.label)}</button>`,
          )
          .join("")}
      </div></div>`;
    bg.onclick = (e) => {
      if (e.target === bg) (bg.remove(), resolve(null));
      const key = e.target.dataset?.key;
      if (key !== undefined) (bg.remove(), resolve(key || null));
    };
    $("overlay").appendChild(bg);
  });
}

function createBusinessDialog() {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">
    <h3>Create a business</h3>
    <p class="sub">One assistant, one price list, one voice. You choose where it answers next.</p>
    <div class="form-row"><label>Business name</label>
      <input id="bizName" placeholder="Sunrise Bakery" autocomplete="off"></div>
    <div class="form-row"><label>Where should it answer?</label>
      <select id="bizType">
        <option value="web">My website · nothing else needed</option>
        <option value="telegram">Telegram · I have a bot token</option>
      </select>
      <small>Either way you can add the other channel afterwards.</small>
    </div>
    <div class="form-row" id="tokRow" hidden><label>Telegram bot token</label>
      <input id="bizToken" placeholder="123456:ABC-DEF…" autocomplete="off">
      <small>From @BotFather. Sealed with your deployment's own key before it is stored.</small></div>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" id="cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="create">Create</button>
    </div></div>`;
  $("overlay").appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector("#cancel").onclick = close;
  bg.onclick = (e) => e.target === bg && close();
  bg.querySelector("#bizType").onchange = (e) =>
    (bg.querySelector("#tokRow").hidden = e.target.value !== "telegram");
  bg.querySelector("#bizName").focus();
  bg.querySelector("#create").onclick = async () => {
    const name = bg.querySelector("#bizName").value.trim();
    if (!name) return;
    const wantsTelegram = bg.querySelector("#bizType").value === "telegram";
    const botToken = bg.querySelector("#bizToken").value.trim();
    if (wantsTelegram && !botToken) return toast("Paste the bot token, or choose the website route.");
    bg.querySelector("#create").disabled = true;
    const { ok, data } = await api("businesses", { method: "POST", body: { name } });
    if (!ok) return (bg.querySelector("#create").disabled = false);
    if (wantsTelegram) {
      const attached = await api(`businesses/${data.id}/telegram`, { method: "POST", body: { token: botToken } });
      // The business is already made. Saying so, and saying the bot is not
      // attached, is better than a failure that reads as if nothing happened.
      if (!attached.ok) toast("Business created, but that bot token was refused.");
    }
    close();
    state.overview = null;
    toast("Business created.");
    go("businesses");
    businessDetail(data.id);
  };
}

function addProductDialog(businessId) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">
    <h3>Add to the price list</h3>
    <p class="sub">The agent quotes from this and nowhere else.</p>
    <div class="form-row"><label>Item</label><input id="pName" placeholder="Chocolate cake, 1 lb"></div>
    <div class="form-row"><label>Price</label><input id="pPrice" placeholder="450 THB"></div>
    <div class="form-row"><label>Description</label><input id="pDesc" placeholder="Serves 6 to 8. Order a day ahead."></div>
    <div class="actions">
      <button class="btn btn-ghost btn-sm" id="cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="save">Add</button>
    </div></div>`;
  $("overlay").appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector("#cancel").onclick = close;
  bg.onclick = (e) => e.target === bg && close();
  bg.querySelector("#pName").focus();
  bg.querySelector("#save").onclick = async () => {
    const name = bg.querySelector("#pName").value.trim();
    if (!name) return;
    await api(`businesses/${businessId}/products`, {
      method: "POST",
      body: {
        name,
        price: bg.querySelector("#pPrice").value,
        description: bg.querySelector("#pDesc").value,
      },
    });
    close();
    businessDetail(businessId);
  };
}

// ------------------------------------------------------------------ connect

function showConsole(on) {
  $("app").classList.toggle("connected", on);
  $("onboarding").hidden = on;
  $("workspace").hidden = !on;
  $("connUrl").textContent = worker.replace(/^https:\/\//, "");
}

async function post(path, body, auth) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: await response.json().catch(() => ({})) };
}

$("connectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("workerUrl").value.trim();
  if (!url) return;
  $("connectBtn").disabled = true;
  $("connectErr").classList.remove("on");
  const { ok, data } = await post("/api/connect", { worker: url });
  $("connectBtn").disabled = false;
  if (!ok) {
    $("connectErr").textContent = data.message || "Could not reach that deployment.";
    $("connectErr").classList.add("on");
    return;
  }
  worker = data.base;
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
  const { ok, data } = await post("/api/pair", { worker, code });
  $("pairBtn").disabled = false;
  if (!ok) {
    $("connectErr").textContent = data.message || "That code did not work.";
    $("connectErr").classList.add("on");
    return;
  }
  token = data.token;
  localStorage.setItem(TOK, token);
  showConsole(true);
  go("home");
});

$("disconnect").addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem(KEY);
  localStorage.removeItem(TOK);
  worker = "";
  token = "";
  clearInterval(state.poll);
  showConsole(false);
});

document.querySelectorAll(".nav-item").forEach((n) =>
  n.addEventListener("click", () => go(n.dataset.tab, { businessId: null, customerId: null })));

if (worker && token) {
  showConsole(true);
  go("home");
} else {
  showConsole(false);
}
